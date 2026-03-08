import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import {
  getVisibleCharacterQuestions,
  type CharacterQuestion,
} from "@/lib/campaigns";

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function getTextareaMaxLength(question: CharacterQuestion) {
  return question.maxLength ?? 280;
}

function buildHeuristicPhysicalDescription(concept: string) {
  const normalizedConcept = concept.toLowerCase();
  const descriptors: string[] = [];

  if (/\bhalf[- ]el(f|ven)\b/.test(normalizedConcept)) {
    descriptors.push("A half-elven traveler with sharp features and slightly pointed ears");
  } else if (/\belf|elven\b/.test(normalizedConcept)) {
    descriptors.push("An elf with angular features, watchful eyes, and a light step");
  } else if (/\bdwarf|dwarven\b/.test(normalizedConcept)) {
    descriptors.push("A sturdy figure with a compact frame, weathered features, and a grounded stance");
  } else if (/\bhuman\b/.test(normalizedConcept)) {
    descriptors.push("A road-worn human with practical clothes and an alert, measured gaze");
  } else {
    descriptors.push("A capable adventurer with a practical look shaped by hard travel and harsher work");
  }

  if (/\bfast|quick|nimble|agile\b/.test(normalizedConcept)) {
    descriptors.push("They move with quick, economical precision");
  }

  if (/\bquiet|silent|soft-spoken|stealthy\b/.test(normalizedConcept)) {
    descriptors.push("Their posture is controlled and quiet, with the habit of stepping softly and watching first");
  }

  if (/\breliable|steady|dependable\b/.test(normalizedConcept)) {
    descriptors.push("There is a steady, dependable calm in the way they carry themselves");
  }

  if (/\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(normalizedConcept)) {
    descriptors.push("A pair of long swords rest within easy reach, worn like tools they trust");
  } else if (/\blong sword|longsword\b/.test(normalizedConcept)) {
    descriptors.push("A well-kept longsword hangs at their side");
  } else if (/\bbow|archer\b/.test(normalizedConcept)) {
    descriptors.push("They keep the compact posture of someone used to drawing and firing quickly");
  }

  if (/\bcaravan guard\b/.test(normalizedConcept) || /\btravel|travelling|traveling|road\b/.test(normalizedConcept)) {
    descriptors.push("Sun-faded gear, dust-worn boots, and the habits of a seasoned road traveler hint at years spent guarding caravans");
  }

  return descriptors.join(". ").replace(/\.+$/g, "").concat(".");
}

function getQuestionFallback(
  question: CharacterQuestion,
  currentAnswers: Record<string, string | number | null | undefined>,
) {
  const currentValue = currentAnswers[question.id];

  if (typeof currentValue === "string" || typeof currentValue === "number") {
    return currentValue;
  }

  if (
    typeof question.defaultValue === "string" ||
    typeof question.defaultValue === "number"
  ) {
    return question.defaultValue;
  }

  if (question.kind === "select" && question.options?.[0]) {
    return question.options[0].value;
  }

  if (question.kind === "number") {
    return question.min ?? 0;
  }

  return "";
}

function sanitizeSuggestedAnswers(
  questions: CharacterQuestion[],
  rawAnswers: Record<string, unknown> | null,
  currentAnswers: Record<string, string | number | null | undefined>,
  lockedFieldIds: Set<string>,
) {
  const sanitizedAnswers: Record<string, string | number> = {};

  for (const question of questions) {
    const currentValue = currentAnswers[question.id];

    if (lockedFieldIds.has(question.id)) {
      if (typeof currentValue === "string" || typeof currentValue === "number") {
        sanitizedAnswers[question.id] = currentValue;
      } else {
        sanitizedAnswers[question.id] = getQuestionFallback(question, currentAnswers);
      }
      continue;
    }

    const suggestedValue = rawAnswers?.[question.id];

    if (question.kind === "select") {
      const matchingOption =
        typeof suggestedValue === "string"
          ? question.options?.find((option) => {
              const normalizedSuggestedValue = normalizeOptionToken(suggestedValue);
              const normalizedOptionValue = normalizeOptionToken(option.value);
              const normalizedOptionLabel = normalizeOptionToken(option.label);

              return (
                normalizedSuggestedValue === normalizedOptionValue ||
                normalizedSuggestedValue === normalizedOptionLabel ||
                normalizedOptionValue.includes(normalizedSuggestedValue) ||
                normalizedSuggestedValue.includes(normalizedOptionValue) ||
                normalizedOptionLabel.includes(normalizedSuggestedValue) ||
                normalizedSuggestedValue.includes(normalizedOptionLabel)
              );
            }) ?? null
          : null;
      const nextValue = matchingOption
        ? matchingOption.value
        : getQuestionFallback(question, currentAnswers);
      sanitizedAnswers[question.id] = String(nextValue);
      continue;
    }

    if (question.kind === "number") {
      const parsedValue =
        typeof suggestedValue === "number"
          ? suggestedValue
          : typeof suggestedValue === "string" && suggestedValue.trim()
            ? Number(suggestedValue)
            : Number(getQuestionFallback(question, currentAnswers));
      const clampedValue = Number.isFinite(parsedValue)
        ? Math.min(
            question.max ?? parsedValue,
            Math.max(question.min ?? parsedValue, parsedValue),
          )
        : Number(getQuestionFallback(question, currentAnswers));
      sanitizedAnswers[question.id] = clampedValue;
      continue;
    }

    sanitizedAnswers[question.id] =
      typeof suggestedValue === "string"
        ? suggestedValue.trim().slice(0, getTextareaMaxLength(question))
        : String(getQuestionFallback(question, currentAnswers));
  }

  return sanitizedAnswers;
}

function buildHeuristicSuggestions(
  concept: string,
  questions: CharacterQuestion[],
) {
  const normalizedConcept = concept.toLowerCase();
  const normalizedConceptToken = normalizeOptionToken(concept);
  const heuristicAnswers: Record<string, unknown> = {};
  const isDeadlandsQuestionnaire = questions.some((question) => question.id === "deftness");
  const inferredDeadlandsArchetype = inferDeadlandsArchetype(concept, "Gunslinger");

  for (const question of questions) {
    if (question.kind === "select" && question.options) {
      const matchedOption = question.options.find((option) =>
        normalizedConcept.includes(option.value.toLowerCase()) ||
        normalizeOptionToken(option.value).includes(normalizedConceptToken) ||
        normalizedConceptToken.includes(normalizeOptionToken(option.value)) ||
        normalizeOptionToken(option.label).includes(normalizedConceptToken) ||
        normalizedConceptToken.includes(normalizeOptionToken(option.label)),
      );

      if (matchedOption) {
        heuristicAnswers[question.id] = matchedOption.value;
        continue;
      }

      if (isDeadlandsQuestionnaire) {
        if (question.id === "archetype") {
          heuristicAnswers[question.id] = inferredDeadlandsArchetype;
          continue;
        }

        if (question.id === "edgeOne") {
          heuristicAnswers[question.id] =
            ["Blessed", "Huckster", "Shaman", "Mad Scientist"].includes(
              inferredDeadlandsArchetype,
            )
              ? "Arcane Background"
              : inferredDeadlandsArchetype === "Gunslinger"
                ? "Quick Draw"
                : "Hard to Kill";
          continue;
        }

        if (question.id === "hindranceOne") {
          heuristicAnswers[question.id] = /\bwanted|outlaw|fugitive\b/.test(normalizedConcept)
            ? "Wanted"
            : /\bvengeful|revenge\b/.test(normalizedConcept)
              ? "Vengeful"
              : "Enemy";
          continue;
        }
      }

      if (question.id === "class" && /\b(warrior|soldier|mercenary|guard|fighter)\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = "Fighter";
        continue;
      }

      if (question.id === "ancestry" && /\bhalf[- ]el(f|ven)\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = "Half-Elf";
        continue;
      }

      if (question.id === "mainHand") {
        if (/\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Longsword";
          continue;
        }

        if (/\b(two[- ]handed|greatsword|big sword|large sword|huge sword)\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Greataxe";
          continue;
        }

        if (/\bbow|archer|ranged\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Rapier";
          continue;
        }
      }

      if (question.id === "offHand") {
        if (/\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Longsword";
          continue;
        }

        if (/\bdagger|knife\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Dagger";
          continue;
        }
      }

      if (question.id === "rangedWeapon" && /\bbow|archer|ranged\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = "Longbow";
        continue;
      }

      if (question.id === "armor") {
        if (/\b(fast|quiet|stealth|light on.*feet)\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Leather";
          continue;
        }

        if (/\bheavy armor|plate|mail\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Chain Mail";
          continue;
        }

        if (/\blight armor|leather|stealthy\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Leather";
          continue;
        }
      }

      if (question.id === "shieldEquipped") {
        if (/\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "No";
          continue;
        }

        if (/\bshield|defensive|tank|protector\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Yes";
          continue;
        }
      }

      if (question.id === "fightingStyle" && /\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = "Two-Weapon Fighting";
        continue;
      }
    }

    if (question.kind === "number") {
      if (question.id === "str" && /\bwarrior|guard|fighter|strong|powerful|muscular|brute\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 15);
        continue;
      }

      if (question.id === "str" && /\bstrong|powerful|muscular|brute\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 16);
        continue;
      }

      if (question.id === "int" && /\bstupid|dumb|slow|not smart|dim\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.max(question.min ?? 8, 8);
        continue;
      }

      if (question.id === "dex" && /\bagile|quick|nimble|fast\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 16);
        continue;
      }

      if (question.id === "con" && /\btough|hardy|durable\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 15);
        continue;
      }
    }

    if (question.kind === "textarea") {
      if (question.id === "background") {
        if (/\bcaravan guard\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] =
            "Raised around merchant roads and caravan camps, learning watch routines, travel discipline, and how to stay alert in unfamiliar territory.";
        } else {
          heuristicAnswers[question.id] = `Drawn from the concept: ${concept.trim()}`.slice(
            0,
            getTextareaMaxLength(question),
          );
        }
        continue;
      }

      if (question.id === "physicalDescription") {
        heuristicAnswers[question.id] = buildHeuristicPhysicalDescription(concept).slice(
          0,
          getTextareaMaxLength(question),
        );
        continue;
      }

      if (question.id === "personality") {
        const personalityNotes: string[] = [];

        if (/\bfast|quick|nimble\b/.test(normalizedConcept)) {
          personalityNotes.push("moves quickly and acts decisively");
        }
        if (/\bquiet|silent|soft-spoken|stealthy\b/.test(normalizedConcept)) {
          personalityNotes.push("prefers measured words and quiet movement");
        }
        if (/\breliable|steady|dependable\b/.test(normalizedConcept)) {
          personalityNotes.push("keeps promises and holds the line under pressure");
        }

        heuristicAnswers[question.id] =
          (personalityNotes.join("; ") || concept.trim()).slice(
            0,
            getTextareaMaxLength(question),
          );
      }
    }
  }

  return heuristicAnswers;
}

function inferDeadlandsArchetype(
  concept: string,
  fallback = "Gunslinger",
) {
  const normalizedConcept = concept.toLowerCase();

  if (/\bpreacher|priest|faith|holy|blessed\b/.test(normalizedConcept)) {
    return "Blessed";
  }

  if (/\bhuckster|card sharp|hex|gambl|gamblin\b/.test(normalizedConcept)) {
    return "Huckster";
  }

  if (/\btribal|totem|spirit talk|medicine man|shaman\b/.test(normalizedConcept)) {
    return "Shaman";
  }

  if (/\binventor|gizmo|mad science|scientist|contraption|clockwork\b/.test(normalizedConcept)) {
    return "Mad Scientist";
  }

  if (/\blaw|marshal|deputy|sheriff|lawman\b/.test(normalizedConcept)) {
    return "Lawman";
  }

  if (/\bbounty hunter|tracker|hunt\b/.test(normalizedConcept)) {
    return "Bounty Hunter";
  }

  if (/\bscout|trail|woodsman|ranger\b/.test(normalizedConcept)) {
    return "Scout / Tracker";
  }

  if (/\bsoldier|cavalry|trooper|veteran\b/.test(normalizedConcept)) {
    return "Soldier / Cavalry";
  }

  if (/\bprospector|miner|claim\b/.test(normalizedConcept)) {
    return "Prospector";
  }

  if (/\bshowman|performer|entertainer|actor|singer\b/.test(normalizedConcept)) {
    return "Showman / Entertainer";
  }

  if (/\bgambler|card\b/.test(normalizedConcept)) {
    return "Gambler";
  }

  if (/\bgunslinger|quick draw|duelist|gunfighter\b/.test(normalizedConcept)) {
    return "Gunslinger";
  }

  return fallback;
}

function findQuestion(
  questions: CharacterQuestion[],
  id: string,
) {
  return questions.find((question) => question.id === id) ?? null;
}

function findSelectOptionValue(
  questions: CharacterQuestion[],
  id: string,
  preferredValues: string[],
) {
  const question = findQuestion(questions, id);

  if (!question || question.kind !== "select" || !question.options?.length) {
    return null;
  }

  for (const preferredValue of preferredValues) {
    const normalizedPreferred = normalizeOptionToken(preferredValue);
    const matchedOption = question.options.find((option) => {
      const normalizedValue = normalizeOptionToken(option.value);
      const normalizedLabel = normalizeOptionToken(option.label);

      return (
        normalizedPreferred === normalizedValue ||
        normalizedPreferred === normalizedLabel ||
        normalizedValue.includes(normalizedPreferred) ||
        normalizedPreferred.includes(normalizedValue) ||
        normalizedLabel.includes(normalizedPreferred) ||
        normalizedPreferred.includes(normalizedLabel)
      );
    });

    if (matchedOption) {
      return matchedOption.value;
    }
  }

  return null;
}

function clampQuestionNumber(
  question: CharacterQuestion | null,
  value: number,
) {
  if (!question || question.kind !== "number") {
    return value;
  }

  return Math.min(
    question.max ?? value,
    Math.max(question.min ?? value, value),
  );
}

function buildDndStatSpread(
  selectedClass: string,
  questions: CharacterQuestion[],
) {
  const priorityByClass: Record<string, string[]> = {
    Barbarian: ["str", "con", "dex", "wis", "cha", "int"],
    Bard: ["cha", "dex", "con", "wis", "int", "str"],
    Cleric: ["wis", "con", "str", "cha", "dex", "int"],
    Druid: ["wis", "con", "dex", "int", "cha", "str"],
    Fighter: ["str", "dex", "con", "wis", "cha", "int"],
    Monk: ["dex", "wis", "con", "str", "int", "cha"],
    Paladin: ["str", "cha", "con", "wis", "dex", "int"],
    Ranger: ["dex", "wis", "con", "str", "cha", "int"],
    Rogue: ["dex", "int", "cha", "con", "wis", "str"],
    Sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
    Warlock: ["cha", "con", "dex", "wis", "int", "str"],
    Wizard: ["int", "dex", "con", "wis", "cha", "str"],
  };
  const spread = [16, 14, 14, 12, 10, 8];
  const orderedStats = priorityByClass[selectedClass] ?? ["str", "con", "dex", "wis", "cha", "int"];
  const statAssignments: Record<string, number> = {};

  orderedStats.forEach((statId, index) => {
    const question = findQuestion(questions, statId);

    if (!question || question.kind !== "number") {
      return;
    }

    statAssignments[statId] = clampQuestionNumber(question, spread[index] ?? 10);
  });

  return statAssignments;
}

function buildDndSpellSuggestions(
  selectedClass: string,
  questions: CharacterQuestion[],
) {
  const spellPreferences: Record<string, Record<string, string[]>> = {
    Bard: {
      cantripOne: ["Vicious Mockery", "Mage Hand"],
      cantripTwo: ["Light", "Minor Illusion"],
      spellLevel1A: ["Healing Word", "Dissonant Whispers"],
      spellLevel1B: ["Charm Person", "Faerie Fire"],
      spellLevel2A: ["Invisibility", "Shatter"],
      spellLevel2B: ["Suggestion", "Lesser Restoration"],
      spellLevel3A: ["Hypnotic Pattern", "Dispel Magic"],
    },
    Cleric: {
      cantripOne: ["Sacred Flame", "Guidance"],
      cantripTwo: ["Light", "Thaumaturgy"],
      cantripThree: ["Spare the Dying", "Resistance"],
      spellLevel1A: ["Bless", "Healing Word"],
      spellLevel1B: ["Shield of Faith", "Cure Wounds"],
      spellLevel2A: ["Lesser Restoration", "Spiritual Weapon"],
      spellLevel2B: ["Aid", "Hold Person"],
      spellLevel3A: ["Spirit Guardians", "Revivify"],
    },
    Druid: {
      cantripOne: ["Produce Flame", "Guidance"],
      cantripTwo: ["Shillelagh", "Resistance"],
      cantripThree: ["Druidcraft", "Thorn Whip"],
      spellLevel1A: ["Entangle", "Cure Wounds"],
      spellLevel1B: ["Faerie Fire", "Goodberry"],
      spellLevel2A: ["Moonbeam", "Lesser Restoration"],
      spellLevel2B: ["Pass without Trace", "Spike Growth"],
      spellLevel3A: ["Call Lightning", "Plant Growth"],
    },
    Paladin: {
      spellLevel1A: ["Bless", "Shield of Faith"],
      spellLevel1B: ["Cure Wounds", "Command"],
      spellLevel2A: ["Lesser Restoration", "Magic Weapon"],
      spellLevel2B: ["Aid", "Find Steed"],
      spellLevel3A: ["Aura of Vitality", "Revivify"],
    },
    Ranger: {
      spellLevel1A: ["Hunter's Mark", "Cure Wounds"],
      spellLevel1B: ["Goodberry", "Longstrider"],
      spellLevel2A: ["Pass without Trace", "Spike Growth"],
      spellLevel2B: ["Lesser Restoration", "Silence"],
      spellLevel3A: ["Conjure Animals", "Lightning Arrow"],
    },
    Sorcerer: {
      cantripOne: ["Fire Bolt", "Mage Hand"],
      cantripTwo: ["Light", "Minor Illusion"],
      cantripThree: ["Prestidigitation", "Ray of Frost"],
      spellLevel1A: ["Magic Missile", "Shield"],
      spellLevel1B: ["Chromatic Orb", "Mage Armor"],
      spellLevel2A: ["Misty Step", "Scorching Ray"],
      spellLevel2B: ["Mirror Image", "Hold Person"],
      spellLevel3A: ["Fireball", "Counterspell"],
    },
    Warlock: {
      cantripOne: ["Eldritch Blast", "Mage Hand"],
      cantripTwo: ["Minor Illusion", "Light"],
      cantripThree: ["Prestidigitation", "Friends"],
      spellLevel1A: ["Hex", "Armor of Agathys"],
      spellLevel1B: ["Charm Person", "Protection from Evil and Good"],
      spellLevel2A: ["Misty Step", "Hold Person"],
      spellLevel2B: ["Mirror Image", "Invisibility"],
      spellLevel3A: ["Counterspell", "Fear"],
    },
    Wizard: {
      cantripOne: ["Fire Bolt", "Mage Hand"],
      cantripTwo: ["Light", "Minor Illusion"],
      cantripThree: ["Ray of Frost", "Prestidigitation"],
      spellLevel1A: ["Magic Missile", "Shield"],
      spellLevel1B: ["Mage Armor", "Detect Magic"],
      spellLevel2A: ["Misty Step", "Scorching Ray"],
      spellLevel2B: ["Mirror Image", "Hold Person"],
      spellLevel3A: ["Fireball", "Counterspell"],
    },
  };
  const selectedPreferences = spellPreferences[selectedClass] ?? {};
  const spellAssignments: Record<string, string> = {};

  for (const question of questions) {
    if (question.kind !== "select" || !/spell|cantrip/i.test(question.id)) {
      continue;
    }

    const preferredOption =
      findSelectOptionValue(
        questions,
        question.id,
        selectedPreferences[question.id] ?? [],
      ) ??
      findSelectOptionValue(questions, question.id, ["None"]);

    if (preferredOption) {
      spellAssignments[question.id] = preferredOption;
    }
  }

  return spellAssignments;
}

function buildDndEquipmentSuggestions(
  concept: string,
  selectedClass: string,
  questions: CharacterQuestion[],
) {
  const normalizedConcept = concept.toLowerCase();
  const isDualWield =
    /\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(
      normalizedConcept,
    );
  const prefersStealth = /\bfast|quick|nimble|agile|quiet|silent|stealthy\b/.test(
    normalizedConcept,
  );
  const equipmentByClass: Record<
    string,
    {
      mainHand: string[];
      offHand: string[];
      rangedWeapon: string[];
      armor: string[];
      shieldEquipped?: string[];
      gearKit: string[];
      fightingStyle?: string[];
    }
  > = {
    Barbarian: {
      mainHand: ["Greataxe", "Longsword"],
      offHand: ["None"],
      rangedWeapon: ["Javelin", "None"],
      armor: ["No Armor", "Chain Mail"],
      shieldEquipped: ["No"],
      gearKit: ["Explorer Pack", "Traveler's Pack"],
    },
    Bard: {
      mainHand: ["Rapier", "Dagger"],
      offHand: ["None", "Dagger"],
      rangedWeapon: ["Longbow", "Crossbow"],
      armor: ["Leather"],
      shieldEquipped: ["No"],
      gearKit: ["Entertainer Case", "Scholar Pack"],
    },
    Cleric: {
      mainHand: ["Warhammer", "Longsword"],
      offHand: ["None"],
      rangedWeapon: ["Crossbow", "Sling"],
      armor: ["Chain Mail", "Scale Mail"],
      shieldEquipped: ["Yes"],
      gearKit: ["Priest Satchel", "Scholar Pack"],
    },
    Druid: {
      mainHand: ["Quarterstaff", "Scimitar"],
      offHand: ["None"],
      rangedWeapon: ["Longbow", "Sling"],
      armor: ["Leather", "No Armor"],
      shieldEquipped: ["No"],
      gearKit: ["Explorer Pack", "Traveler's Pack"],
    },
    Fighter: {
      mainHand: isDualWield ? ["Longsword", "Rapier"] : prefersStealth ? ["Rapier", "Longsword"] : ["Longsword", "Greataxe"],
      offHand: isDualWield ? ["Longsword", "Shortsword"] : ["None"],
      rangedWeapon: prefersStealth ? ["Longbow", "Crossbow"] : ["Crossbow", "Javelin"],
      armor: prefersStealth ? ["Leather", "Chain Shirt"] : ["Chain Mail", "Scale Mail"],
      shieldEquipped: isDualWield ? ["No"] : ["Yes", "No"],
      gearKit: ["Explorer Pack", "Traveler's Pack"],
      fightingStyle: isDualWield
        ? ["Two-Weapon Fighting", "Defense"]
        : prefersStealth
          ? ["Dueling", "Defense"]
          : ["Defense", "Great Weapon Fighting"],
    },
    Monk: {
      mainHand: ["Quarterstaff", "Spear"],
      offHand: ["None"],
      rangedWeapon: ["Shortbow", "Sling"],
      armor: ["No Armor"],
      shieldEquipped: ["No"],
      gearKit: ["Monastic Satchel", "Traveler's Pack"],
    },
    Paladin: {
      mainHand: ["Longsword", "Warhammer"],
      offHand: ["None"],
      rangedWeapon: ["Javelin", "Crossbow"],
      armor: ["Chain Mail", "Plate"],
      shieldEquipped: ["Yes"],
      gearKit: ["Priest Satchel", "Explorer Pack"],
      fightingStyle: ["Defense", "Dueling"],
    },
    Ranger: {
      mainHand: prefersStealth ? ["Rapier", "Shortsword"] : ["Longsword", "Rapier"],
      offHand: isDualWield ? ["Shortsword", "Scimitar"] : ["None"],
      rangedWeapon: ["Longbow", "Crossbow"],
      armor: ["Leather", "Chain Shirt"],
      shieldEquipped: isDualWield ? ["No"] : ["No", "Yes"],
      gearKit: ["Explorer Pack", "Traveler's Pack"],
      fightingStyle: ["Archery", "Two-Weapon Fighting"],
    },
    Rogue: {
      mainHand: isDualWield ? ["Rapier", "Shortsword"] : ["Rapier", "Shortsword"],
      offHand: isDualWield ? ["Shortsword", "Dagger"] : ["None"],
      rangedWeapon: ["Shortbow", "Crossbow"],
      armor: ["Leather"],
      shieldEquipped: ["No"],
      gearKit: ["Burglar Kit", "Traveler's Pack"],
    },
    Sorcerer: {
      mainHand: ["Quarterstaff", "Dagger"],
      offHand: ["None"],
      rangedWeapon: ["Crossbow", "Sling"],
      armor: ["No Armor", "Leather"],
      shieldEquipped: ["No"],
      gearKit: ["Scholar Pack", "Traveler's Pack"],
    },
    Warlock: {
      mainHand: ["Quarterstaff", "Rapier"],
      offHand: ["None"],
      rangedWeapon: ["Crossbow", "Sling"],
      armor: ["Leather", "No Armor"],
      shieldEquipped: ["No"],
      gearKit: ["Scholar Pack", "Explorer Pack"],
    },
    Wizard: {
      mainHand: ["Quarterstaff", "Dagger"],
      offHand: ["None"],
      rangedWeapon: ["Crossbow", "Sling"],
      armor: ["No Armor"],
      shieldEquipped: ["No"],
      gearKit: ["Scholar Pack", "Traveler's Pack"],
    },
  };

  const defaults = equipmentByClass[selectedClass] ?? {
    mainHand: ["Longsword"],
    offHand: ["None"],
    rangedWeapon: ["None"],
    armor: ["Leather"],
    shieldEquipped: ["No"],
    gearKit: ["Traveler's Pack"],
  };
  const equipmentAssignments: Record<string, string> = {};

  const mainHand = findSelectOptionValue(questions, "mainHand", defaults.mainHand);
  if (mainHand) {
    equipmentAssignments.mainHand = mainHand;
  }

  const offHand = findSelectOptionValue(questions, "offHand", defaults.offHand);
  if (offHand) {
    equipmentAssignments.offHand = offHand;
  }

  const rangedWeapon = findSelectOptionValue(
    questions,
    "rangedWeapon",
    defaults.rangedWeapon,
  );
  if (rangedWeapon) {
    equipmentAssignments.rangedWeapon = rangedWeapon;
  }

  const armor = findSelectOptionValue(questions, "armor", defaults.armor);
  if (armor) {
    equipmentAssignments.armor = armor;
  }

  if (defaults.shieldEquipped) {
    const shieldEquipped = findSelectOptionValue(
      questions,
      "shieldEquipped",
      defaults.shieldEquipped,
    );

    if (shieldEquipped) {
      equipmentAssignments.shieldEquipped = shieldEquipped;
    }
  }

  const gearKit = findSelectOptionValue(questions, "gearKit", defaults.gearKit);
  if (gearKit) {
    equipmentAssignments.gearKit = gearKit;
  }

  if (defaults.fightingStyle) {
    const fightingStyle = findSelectOptionValue(
      questions,
      "fightingStyle",
      defaults.fightingStyle,
    );

    if (fightingStyle) {
      equipmentAssignments.fightingStyle = fightingStyle;
    }
  }

  return equipmentAssignments;
}

function buildDraftModeEnhancements(
  ruleset: string,
  concept: string,
  questions: CharacterQuestion[],
  currentAnswers: Record<string, string | number | null | undefined>,
  baseAnswers: Record<string, unknown>,
) {
  const normalizedRuleset = ruleset.trim().toLowerCase();

  if (normalizedRuleset === "d&d 5e") {
    const selectedClass =
      (typeof baseAnswers.class === "string" && baseAnswers.class) ||
      (typeof currentAnswers.class === "string" && currentAnswers.class) ||
      "Fighter";

    return {
      ...buildDndStatSpread(selectedClass, questions),
      ...buildDndSpellSuggestions(selectedClass, questions),
      ...buildDndEquipmentSuggestions(concept, selectedClass, questions),
    };
  }

  const numericDefaults: Record<string, number> = {};
  const selectDefaults: Record<string, string> = {};
  const normalizedConcept = concept.toLowerCase();

  if (normalizedRuleset === "deadlands classic") {
    const baseArchetype =
      (typeof baseAnswers.archetype === "string" && baseAnswers.archetype) || "Gunslinger";
    const archetype = inferDeadlandsArchetype(concept, baseArchetype);
    numericDefaults.guts =
      /\bgrim|fearless|hardened|veteran\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.deftness =
      archetype === "Gunslinger" || archetype === "Gambler" ? 4 : 3;
    numericDefaults.nimbleness =
      /\bquick|fast|agile|nimble|quiet\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.quickness =
      /\bquick|fast|agile|nimble|quiet\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.strength =
      /\bstrong|tough|brawler|soldier|cavalry\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.vigor =
      /\bhardy|survivor|veteran|durable|tough\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.cognition =
      /\bwatchful|tracker|scout|investigator|careful\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.knowledge =
      /\bbook|smart|scholar|scientist|educated\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.mien =
      /\bcharming|showman|speaker|lawman\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.smarts =
      /\bclever|cunning|huckster|gambler|scientist\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.spirit =
      /\bfaith|blessed|shaman|willful|gritty\b/.test(normalizedConcept) ? 4 : 3;
    numericDefaults.woundHead = 0;
    numericDefaults.woundGuts = /\bwounded|injured|hurt|gut shot\b/.test(normalizedConcept) ? 1 : 0;
    numericDefaults.woundLeftArm = 0;
    numericDefaults.woundRightArm = 0;
    numericDefaults.woundLeftLeg = 0;
    numericDefaults.woundRightLeg = 0;
    numericDefaults.fateWhite = 2;
    numericDefaults.fateRed = 1;
    numericDefaults.fateBlue = 0;
    numericDefaults.fateLegend = 0;
    selectDefaults.archetype = archetype;
    selectDefaults.hindranceOne =
      /\bwanted|fugitive|outlaw\b/.test(normalizedConcept)
        ? "Wanted"
        : /\bvengeful|revenge\b/.test(normalizedConcept)
          ? "Vengeful"
          : /\bgreed|greedy\b/.test(normalizedConcept)
            ? "Greedy"
            : "Enemy";
    selectDefaults.hindranceTwo =
      /\bnightmare|terror|haunted\b/.test(normalizedConcept) ? "Night Terrors" : "None";
    selectDefaults.primarySkill =
      archetype === "Blessed"
        ? "Faith"
        : archetype === "Huckster"
          ? "Hexslingin'"
          : archetype === "Mad Scientist"
            ? "Mad Science"
            : archetype === "Scout / Tracker"
              ? "Tracking"
              : archetype === "Showman / Entertainer"
                ? "Persuasion"
                : "Shootin'";
    selectDefaults.secondarySkill =
      archetype === "Blessed"
        ? "Guts"
        : archetype === "Huckster"
          ? "Scrutinize"
          : archetype === "Mad Scientist"
            ? "Knowledge"
            : archetype === "Scout / Tracker"
              ? "Survival"
              : archetype === "Showman / Entertainer"
                ? "Ridicule"
                : "Dodge";
    selectDefaults.edgeOne =
      archetype === "Blessed" ||
      archetype === "Huckster" ||
      archetype === "Shaman" ||
      archetype === "Mad Scientist"
        ? "Arcane Background"
        : selectDefaults.edgeOne ?? "Quick Draw";
    selectDefaults.edgeTwo =
      archetype === "Gunslinger"
        ? "Level Headed"
        : archetype === "Lawman"
          ? "Keen"
          : selectDefaults.edgeTwo ?? "None";
    selectDefaults.blessedMiracleOne =
      archetype === "Blessed"
        ? /\bheal|protect|holy|guardian\b/.test(normalizedConcept)
          ? "Protection"
          : "Smite"
        : "Smite";
    selectDefaults.blessedMiracleTwo =
      archetype === "Blessed" && /\bheal|protect|holy\b/.test(normalizedConcept)
        ? "Healing"
        : "None";
    selectDefaults.hucksterHexOne =
      archetype === "Huckster"
        ? /\btrick|sneak|shadow\b/.test(normalizedConcept)
          ? "Shadow Man"
          : "Soul Blast"
        : "Soul Blast";
    selectDefaults.hucksterHexTwo =
      archetype === "Huckster" && /\bstealth|trick|shadow\b/.test(normalizedConcept)
        ? "Shadow Man"
        : "None";
    selectDefaults.shamanFavorOne =
      archetype === "Shaman"
        ? /\bstorm|wind|lightning\b/.test(normalizedConcept)
          ? "Storm Calling"
          : "Spirit Warrior"
        : "Spirit Warrior";
    selectDefaults.shamanFavorTwo =
      archetype === "Shaman" && /\bstorm|animal|wild\b/.test(normalizedConcept)
        ? "Storm Calling"
        : "None";
    selectDefaults.madScienceInventionOne =
      archetype === "Mad Scientist"
        ? /\bclock|construct|assistant\b/.test(normalizedConcept)
          ? "Clockwork Assistant"
          : "Electrostatic Projector"
        : "Electrostatic Projector";
    selectDefaults.madScienceInventionTwo =
      archetype === "Mad Scientist" && /\bclock|device|construct|gear\b/.test(normalizedConcept)
        ? "Clockwork Assistant"
        : "None";
    numericDefaults.arcanePool =
      archetype === "Blessed" ||
      archetype === "Huckster" ||
      archetype === "Shaman" ||
      archetype === "Mad Scientist"
        ? /\bveteran|powerful|gifted\b/.test(normalizedConcept)
          ? 4
          : 3
        : 0;
    selectDefaults.mainHand =
      archetype === "Gunslinger" || archetype === "Lawman"
        ? "Colt Peacemaker"
        : archetype === "Bounty Hunter"
          ? "Schofield Revolver"
          : archetype === "Scout / Tracker"
            ? "Bow Knife"
            : "Derringer";
    selectDefaults.offHand =
      /\bdual|two[- ]?gun|two[- ]?weapon\b/.test(normalizedConcept)
        ? "Derringer"
        : "None";
    selectDefaults.longarm =
      archetype === "Soldier / Cavalry" || archetype === "Bounty Hunter"
        ? "Winchester Rifle"
        : archetype === "Scout / Tracker"
          ? "Hunting Rifle"
          : "None";
    selectDefaults.woundIgnore = "None";
  } else if (normalizedRuleset === "savage rifts") {
    const framework =
      (typeof baseAnswers.framework === "string" && baseAnswers.framework) || "Cyber-Knight";
    numericDefaults.bennies =
      /\blucky|survivor|veteran|reliable\b/.test(normalizedConcept) ? 4 : 3;
    selectDefaults.combatRole =
      framework === "Cyber-Knight"
        ? "Frontline"
        : framework === "Operator"
          ? "Support"
          : framework === "Juicer"
            ? "Shock assault"
            : "Tactical";
  } else if (normalizedRuleset === "mutants in the now") {
    const species =
      (typeof baseAnswers.species === "string" && baseAnswers.species) ||
      "Mutant snapping turtle";
    numericDefaults.ferocity =
      /\bferal|violent|strong|brutal\b/.test(normalizedConcept) ? 4 : 3;
    selectDefaults.streetRole =
      species.includes("rat")
        ? "Tinkerer"
        : /\bquiet|stealth|sneak\b/.test(normalizedConcept)
          ? "Scout"
          : "Street bruiser";
  } else if (normalizedRuleset === "astonishing super heroes") {
    const origin =
      (typeof baseAnswers.origin === "string" && baseAnswers.origin) || "Cosmic";
    numericDefaults.control =
      /\bdisciplined|precise|controlled|reliable\b/.test(normalizedConcept) ? 4 : 3;
    selectDefaults.powerProfile =
      origin === "Tech"
        ? "Gadgets and systems"
        : origin === "Mutant"
          ? "Speed and reflex"
          : origin === "Mystic"
            ? "Energy projection"
            : "Force and defense";
  } else if (normalizedRuleset === "star wars rpg") {
    const archetype =
      (typeof baseAnswers.archetype === "string" && baseAnswers.archetype) || "Scoundrel";
    numericDefaults.forceAffinity =
      archetype.toLowerCase().includes("mystic") ||
      /\bforce|mystic|jedi|sensitive\b/.test(normalizedConcept)
        ? 3
        : 1;
    selectDefaults.specialty =
      archetype.toLowerCase().includes("soldier")
        ? "Security"
        : archetype.toLowerCase().includes("pilot")
          ? "Piloting"
          : archetype.toLowerCase().includes("mystic")
            ? "Force lore"
            : "Streetwise";
  } else if (normalizedRuleset === "legend of 5 rings 4e") {
    const clan =
      (typeof baseAnswers.clan === "string" && baseAnswers.clan) || "Crab";
    selectDefaults.school =
      clan === "Crane"
        ? "Crane Courtier"
        : clan === "Phoenix"
          ? "Phoenix Shugenja"
          : clan === "Lion"
            ? "Lion Bushi"
            : "Crab Bushi";
    selectDefaults.ringFocus =
      /\bquiet|patient|observant|calm\b/.test(normalizedConcept)
        ? "Air"
        : /\bstubborn|strong|unyielding\b/.test(normalizedConcept)
          ? "Earth"
          : "Fire";
  } else if (normalizedRuleset === "vampire: the masqureade v5") {
    const clan =
      (typeof baseAnswers.clan === "string" && baseAnswers.clan) || "Brujah";
    numericDefaults.humanity =
      /\bcold|predator|ruthless\b/.test(normalizedConcept) ? 5 : 6;
    selectDefaults.predatorType =
      clan === "Nosferatu"
        ? "Scene queen"
        : /\bquiet|subtle|stealth\b/.test(normalizedConcept)
          ? "Alleycat"
          : "Consensualist";
  } else if (normalizedRuleset === "call of cthulhu") {
    numericDefaults.nerve =
      /\bshaken|nervous|frail\b/.test(normalizedConcept) ? 2 : 3;
    selectDefaults.bestSkill =
      /\bdoctor|medic|surgeon\b/.test(normalizedConcept)
        ? "Medicine"
        : /\bquiet|watchful|detective|investigator\b/.test(normalizedConcept)
          ? "Spot Hidden"
          : "Library Use";
  } else {
    numericDefaults.competence =
      /\bexpert|veteran|reliable|disciplined\b/.test(normalizedConcept) ? 4 : 3;
    selectDefaults.startingEquipment =
      /\bquiet|stealth|scout|light\b/.test(normalizedConcept)
        ? "Traveling gear"
        : /\bmagic|mystic|wizard|arcane\b/.test(normalizedConcept)
          ? "Arcane focus"
          : "Martial kit";
    selectDefaults.startingSpell =
      /\bheal|bless|support\b/.test(normalizedConcept)
        ? "Protective ward"
        : /\bfire|arcane|blast\b/.test(normalizedConcept)
          ? "Arcane bolt"
          : "Utility cantrip";
  }

  const enhancements: Record<string, string | number> = {};

  for (const question of questions) {
    if (question.kind === "number" && typeof numericDefaults[question.id] === "number") {
      enhancements[question.id] = clampQuestionNumber(question, numericDefaults[question.id]);
      continue;
    }

    if (question.kind === "select" && selectDefaults[question.id]) {
      const matchedValue = findSelectOptionValue(questions, question.id, [
        selectDefaults[question.id],
      ]);

      if (matchedValue) {
        enhancements[question.id] = matchedValue;
      }
    }
  }

  return enhancements;
}

function filterTargetQuestions(
  questions: CharacterQuestion[],
  mode: string,
) {
  if (mode === "stats") {
    return questions.filter(
      (question) =>
        question.kind === "number" ||
        ["level"].includes(question.id),
    );
  }

  if (mode === "spells") {
    return questions.filter((question) =>
      /spell|cantrip|hex|miracle|favor|invention|arcanepool/i.test(question.id),
    );
  }

  if (mode === "equipment") {
    return questions.filter((question) =>
      /(weapon|armor|gear|equipment|inventory|ammo|mainhand|offhand|shield)/i.test(question.id),
    );
  }

  if (mode === "notes") {
    return questions.filter((question) =>
      question.kind === "textarea" ||
      /physicalDescription/i.test(question.id),
    );
  }

  if (mode === "identity") {
    return questions.filter(
      (question) =>
        question.kind === "select" &&
        !/(weapon|armor|gear|equipment|inventory|ammo|mainhand|offhand|shield|spell|cantrip|hex|miracle|favor|invention|arcanepool)/i.test(question.id),
    );
  }

  return questions;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ruleset = typeof body.ruleset === "string" ? body.ruleset.trim() : "";
  const concept = typeof body.concept === "string" ? body.concept.trim() : "";
  const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "draft";
  const style = typeof body.style === "string" ? body.style.trim().toLowerCase() : "story-first";
  const currentAnswers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};
  const lockedFieldIds = new Set(
    Array.isArray(body.lockedFieldIds)
      ? body.lockedFieldIds.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
        )
      : [],
  );

  if (!ruleset) {
    return NextResponse.json({ error: "ruleset is required" }, { status: 400 });
  }

  if (!concept) {
    return NextResponse.json({ error: "concept is required" }, { status: 400 });
  }

  const visibleQuestions = getVisibleCharacterQuestions(ruleset, currentAnswers);
  const targetQuestions = filterTargetQuestions(visibleQuestions, mode);

  if (targetQuestions.length === 0) {
    return NextResponse.json({
      answers: {},
      rationale: "No visible fields matched that suggestion step.",
    });
  }

  const promptQuestionSummary = targetQuestions
    .map((question) => {
      if (question.kind === "select") {
        const options = question.options?.map((option) => option.value).join(", ") ?? "";
        return `- ${question.id} (${question.label}): choose one of [${options}]`;
      }

      if (question.kind === "number") {
        return `- ${question.id} (${question.label}): integer ${question.min ?? 0} to ${question.max ?? 999}`;
      }

      return `- ${question.id} (${question.label}): short text`;
    })
    .join("\n");

  const heuristicAnswers = buildHeuristicSuggestions(concept, targetQuestions);
  let rawAnswers: Record<string, unknown> | null = null;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.1-mini",
      input: [
        {
          role: "system",
          content: [
            "You help draft tabletop RPG character creation fields.",
              "Based on the user's concept and the listed target fields, produce a single JSON object.",
              "Only include keys that match the listed field ids.",
            "For select fields, you must choose exactly one allowed option value.",
            "For number fields, return an integer inside the allowed range.",
            style === "rules-first"
              ? "Prefer mechanically coherent, practical, rules-friendly suggestions that still fit the concept."
              : "Prefer evocative, thematic suggestions that strongly express the concept while staying valid.",
            ruleset.trim().toLowerCase() === "deadlands classic"
              ? "For Deadlands Classic, keep choices genre-appropriate and mechanically coherent: arcane archetypes should pair with Arcane Background, relevant casting skills, and fitting powers."
              : "",
            "For textarea fields, return concise flavorful text that fits the concept.",
            "For physicalDescription specifically, infer a visible appearance and physical presence; do not simply repeat or paraphrase the concept text.",
            "Do not include explanation, markdown, or extra text outside the JSON object.",
          ].join(" "),
          },
          {
            role: "user",
            content: [
              `Ruleset: ${ruleset}`,
              `Suggestion mode: ${mode}`,
              `Suggestion style: ${style}`,
              "",
              "Character concept:",
              concept,
            "",
            "Current answers:",
            JSON.stringify(currentAnswers, null, 2),
            "",
            "Locked fields (do not change these):",
            JSON.stringify(Array.from(lockedFieldIds), null, 2),
            "",
            "Target fields:",
            promptQuestionSummary,
          ].join("\n"),
        },
      ],
    });

    const aiAnswers = parseJsonObject(response.output_text ?? "") ?? {};
    rawAnswers = {
      ...heuristicAnswers,
      ...aiAnswers,
      ...(mode === "draft"
        ? buildDraftModeEnhancements(ruleset, concept, targetQuestions, currentAnswers, {
            ...heuristicAnswers,
            ...aiAnswers,
          })
        : {}),
    };
  } catch {
    rawAnswers = {
      ...heuristicAnswers,
      ...(mode === "draft"
        ? buildDraftModeEnhancements(
            ruleset,
            concept,
            targetQuestions,
            currentAnswers,
            heuristicAnswers,
          )
        : {}),
    };
  }

  let finalTargetQuestions = targetQuestions;

  if (mode === "draft") {
    const preliminaryAnswers = sanitizeSuggestedAnswers(
      targetQuestions,
      rawAnswers,
      currentAnswers,
      lockedFieldIds,
    );
    const expandedCurrentAnswers = {
      ...currentAnswers,
      ...preliminaryAnswers,
    };
    const expandedQuestions = getVisibleCharacterQuestions(
      ruleset,
      expandedCurrentAnswers,
    );

    finalTargetQuestions = expandedQuestions;
    rawAnswers = {
      ...rawAnswers,
      ...buildHeuristicSuggestions(concept, expandedQuestions),
      ...buildDraftModeEnhancements(
        ruleset,
        concept,
        expandedQuestions,
        expandedCurrentAnswers,
        {
          ...expandedCurrentAnswers,
          ...rawAnswers,
        },
      ),
    };
  }

  const suggestedAnswers = sanitizeSuggestedAnswers(
    finalTargetQuestions,
    rawAnswers,
    currentAnswers,
    lockedFieldIds,
  );

  const rationaleByMode: Record<string, string> = {
    draft: "Drafted a full pass from the concept for the currently visible fields.",
    identity: "Refined class, ancestry, and other identity choices from the concept.",
    stats: "Suggested level and attribute values that fit the concept.",
    spells: "Suggested spells for the currently visible spell slots and spell fields.",
    equipment: "Suggested gear that fits the concept and current build.",
    notes: "Polished the descriptive notes to better fit the concept.",
  };

  return NextResponse.json({
    answers: suggestedAnswers,
    rationale: `${style === "rules-first" ? "Rules-first" : "Story-first"}: ${
      rationaleByMode[mode] ??
      "Applied AI-assisted suggestions to the visible unlocked fields."
    }`,
  });
}
