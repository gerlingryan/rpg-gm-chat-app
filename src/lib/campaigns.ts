export type StarterCharacter = {
  name: string;
  role: string;
  isMainCharacter: boolean;
  sheetJson: Record<string, unknown>;
  memorySummary: string;
};

export type StarterTemplate = {
  titleHint: string;
  defaultScenario: string;
  characters: StarterCharacter[];
};

export type CharacterQuestionOption = {
  value: string;
  label: string;
};

export type CharacterQuestion = {
  id: string;
  label: string;
  kind: "select" | "number" | "textarea";
  required?: boolean;
  min?: number;
  max?: number;
  defaultValue?: string | number;
  options?: CharacterQuestionOption[];
  helpText?: string;
  maxLength?: number;
  showWhen?: (
    answers: Record<string, string | number | null | undefined>,
  ) => boolean;
};

const CHARACTER_TEXTAREA_LIMITS: Record<string, number> = {
  physicalDescription: 700,
  personality: 1000,
  background: 1800,
};

function getCharacterTextareaLimit(id: string) {
  return CHARACTER_TEXTAREA_LIMITS[id];
}

function truncateTextToMaxLength(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trimEnd();
}

export function sanitizeCharacterAnswersForLimits<
  T extends Record<string, string | number | null | undefined>,
>(answers: T): T {
  const nextAnswers = {
    ...answers,
  } as T;

  for (const [fieldId, maxLength] of Object.entries(CHARACTER_TEXTAREA_LIMITS)) {
    const currentValue = nextAnswers[fieldId];
    if (typeof currentValue !== "string") {
      continue;
    }

    nextAnswers[fieldId] = truncateTextToMaxLength(currentValue, maxLength);
  }

  return nextAnswers;
}

const STARTER_TEMPLATES: Record<string, StarterTemplate> = {
  "d&d 5e": {
    titleHint: "Frontier of Ash",
    defaultScenario:
      "Group starts in a tavern waiting for a contact with an urgent mission.",
    characters: [
      {
        name: "Tarin Hollow",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          class: "Fighter",
          level: 1,
          hp: { current: 12, max: 12 },
          ac: 16,
        },
        memorySummary:
          "A disciplined sellsword who trusts steel, routine, and clear objectives.",
      },
      {
        name: "Sable Fen",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          class: "Rogue",
          level: 1,
          hp: { current: 9, max: 9 },
          ac: 14,
        },
        memorySummary:
          "A watchful scout who notices exits, tells half-truths, and hates wasted time.",
      },
    ],
  },
  "deadlands classic": {
    titleHint: "Ghost Rock Reckoning",
    defaultScenario:
      "The posse steps off a noon train into a frontier town with a fresh corpse, missing ghost rock, and everyone watching their hands.",
    characters: [
      {
        name: "Etta Boone",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          archetype: "Gunslinger",
          pace: 8,
          wind: 10,
          grit: 2,
        },
        memorySummary:
          "A hard-eyed drifter whose first instinct is to draw fast and ask later.",
      },
      {
        name: "Brother Cal Raines",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          archetype: "Blessed",
          pace: 6,
          wind: 12,
          faith: "steady",
        },
        memorySummary:
          "A plain-spoken preacher who fears evil less than what desperate people become.",
      },
    ],
  },
  "savage rifts": {
    titleHint: "Rifts Over Iron Mesa",
    defaultScenario:
      "The team arrives at a badlands outpost just as a dimensional rift tears open above it and competing factions rush for the same distress beacon.",
    characters: [
      {
        name: "Kara Stride",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          framework: "Cyber-Knight",
          pace: 6,
          toughness: 11,
          bennies: 3,
        },
        memorySummary:
          "A principled wanderer trying to hold onto honor in a world built to crush it.",
      },
      {
        name: "Glitch-9",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          framework: "Operator",
          pace: 6,
          toughness: 7,
          bennies: 2,
        },
        memorySummary:
          "A scavenger-tech who treats every battlefield like a salvage puzzle.",
      },
    ],
  },
  "mutants in the now": {
    titleHint: "Subway Clawdown",
    defaultScenario:
      "The crew is in an underground market when armored raiders kick in the barricades and demand tribute from every mutant clan in sight.",
    characters: [
      {
        name: "Rook Snapjaw",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          species: "Mutant snapping turtle",
          role: "Street bruiser",
          hp: 14,
        },
        memorySummary:
          "A stubborn survivor who leads with momentum, appetite, and a short fuse.",
      },
      {
        name: "Ivy Wick",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          species: "Mutant rat",
          role: "Tinkerer",
          hp: 10,
        },
        memorySummary:
          "A fast-talking gearhead who treats social chaos and broken tech the same way.",
      },
    ],
  },
  "astonishing super heroes": {
    titleHint: "Neon Overwatch",
    defaultScenario:
      "The heroes are on patrol when a live supervillain broadcast announces a catastrophic countdown over a crowded downtown skyline.",
    characters: [
      {
        name: "Vector Star",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          origin: "Cosmic",
          powerSet: ["flight", "force fields"],
          health: 20,
        },
        memorySummary:
          "A public hero balancing real compassion with the pressure to look invincible.",
      },
      {
        name: "Night Circuit",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          origin: "Tech",
          powerSet: ["electrokinesis", "hacking"],
          health: 16,
        },
        memorySummary:
          "A tactical vigilante who trusts plans and data more than capes and speeches.",
      },
    ],
  },
  "star wars rpg": {
    titleHint: "Outer Rim Embers",
    defaultScenario:
      "The crew drops out of hyperspace near a quarantined Outer Rim moon and intercepts an old distress signal just before an Imperial patrol arrives.",
    characters: [
      {
        name: "Jax Orin",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          archetype: "Scoundrel pilot",
          strain: 10,
          wounds: { current: 0, threshold: 12 },
        },
        memorySummary:
          "A quick-thinking spacer who masks fear with sarcasm and reckless charm.",
      },
      {
        name: "Tala Venn",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          archetype: "Mystic exile",
          strain: 12,
          wounds: { current: 0, threshold: 10 },
        },
        memorySummary:
          "A quiet Force-sensitive who senses danger early and speaks only when it matters.",
      },
    ],
  },
  "legend of 5 rings 4e": {
    titleHint: "Winter Court Knives",
    defaultScenario:
      "The group arrives at Winter Court moments before a political scandal erupts and their clan is quietly blamed.",
    characters: [
      {
        name: "Isawa Ren",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          school: "Phoenix Courtier",
          honor: 6.5,
          status: 1.5,
        },
        memorySummary:
          "A careful samurai who values restraint, poise, and reading the room before acting.",
      },
      {
        name: "Doji Kiyomi",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          school: "Crane Duelist",
          honor: 7,
          status: 1,
        },
        memorySummary:
          "A graceful ally who uses perfect etiquette as both shield and weapon.",
      },
    ],
  },
  "vampire: the masqureade v5": {
    titleHint: "Midnight Elysium",
    defaultScenario:
      "The coterie gathers at Elysium when a Masquerade breach surfaces and the prince expects them to contain it before dawn.",
    characters: [
      {
        name: "Lucien Vale",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          clan: "Toreador",
          hunger: 2,
          humanity: 7,
        },
        memorySummary:
          "A charming predator who craves control, admiration, and one clean night without panic.",
      },
      {
        name: "Mara Voss",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          clan: "Nosferatu",
          hunger: 1,
          humanity: 6,
        },
        memorySummary:
          "An information broker who expects betrayal and plans for it before sunset.",
      },
    ],
  },
  "call of cthulhu": {
    titleHint: "The Black Tide File",
    defaultScenario:
      "The investigators are summoned to an apparently impossible crime scene where strange evidence suggests something deeply unnatural.",
    characters: [
      {
        name: "Eleanor Price",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          occupation: "Journalist",
          hp: 11,
          sanity: 58,
        },
        memorySummary:
          "A persistent investigator who chases patterns even when common sense says stop.",
      },
      {
        name: "Dr. Simon Hart",
        role: "companion",
        isMainCharacter: false,
        sheetJson: {
          occupation: "Physician",
          hp: 10,
          sanity: 52,
        },
        memorySummary:
          "A rational skeptic whose calm exterior fractures when evidence defies medicine.",
      },
    ],
  },
};

function normalizeRuleset(ruleset: string) {
  return ruleset.trim().toLowerCase();
}

export function getStarterTemplate(ruleset: string): StarterTemplate {
  const template = STARTER_TEMPLATES[normalizeRuleset(ruleset)];

  if (template) {
    return template;
  }

  return {
    titleHint: `${ruleset} Campaign`,
    defaultScenario: `The party begins a new ${ruleset} adventure at the edge of an unfolding crisis.`,
    characters: [
      {
        name: "Main Character",
        role: "player",
        isMainCharacter: true,
        sheetJson: {
          notes: "Starter character sheet placeholder.",
        },
        memorySummary:
          "The player's point-of-view character at the center of the campaign.",
      },
    ],
  };
}

export function getDefaultStartingScenario(ruleset: string) {
  return getStarterTemplate(ruleset).defaultScenario;
}

export function buildOpeningMessageFromScenario(scenario: string) {
  const trimmedScenario = scenario.trim();

  if (!trimmedScenario) {
    return "A fresh scene forms around your main character as the first decision arrives.";
  }

  return trimmedScenario;
}

export function buildCampaignTitle(title: string, ruleset: string) {
  const template = getStarterTemplate(ruleset);
  return title.trim() || template.titleHint;
}

export function markStarterCharacters(characters: StarterCharacter[]) {
  return characters.map((character) => ({
    ...character,
    sheetJson: {
      ...character.sheetJson,
      source: "starter-template",
    },
  }));
}

function createSelectQuestion(
  id: string,
  label: string,
  options: CharacterQuestionOption[],
  helpText?: string,
): CharacterQuestion {
  return {
    id,
    label,
    kind: "select",
    required: true,
    defaultValue: options[0]?.value ?? "",
    options,
    helpText,
  };
}

function createNumberQuestion(
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  helpText?: string,
): CharacterQuestion {
  return {
    id,
    label,
    kind: "number",
    required: true,
    min,
    max,
    defaultValue,
    helpText,
  };
}

function createTextareaQuestion(
  id: string,
  label: string,
  defaultValue = "",
  helpText?: string,
  maxLength?: number,
): CharacterQuestion {
  const enforcedMaxLength = getCharacterTextareaLimit(id);
  const resolvedMaxLength =
    typeof maxLength === "number" && typeof enforcedMaxLength === "number"
      ? Math.min(maxLength, enforcedMaxLength)
      : typeof maxLength === "number"
        ? maxLength
        : enforcedMaxLength;

  return {
    id,
    label,
    kind: "textarea",
    required: false,
    defaultValue,
    helpText,
    maxLength: resolvedMaxLength,
  };
}

function createGenderQuestion(): CharacterQuestion {
  return createSelectQuestion("gender", "Gender", [
    { value: "Male", label: "Male" },
    { value: "Female", label: "Female" },
    { value: "Trans", label: "Trans" },
    { value: "Other", label: "Other" },
  ]);
}

function createAgeQuestion(): CharacterQuestion {
  return createNumberQuestion("age", "Age", 1, 999, 30);
}

export function getCharacterQuestionnaire(ruleset: string): CharacterQuestion[] {
  const normalizedRuleset = normalizeRuleset(ruleset);

  if (normalizedRuleset === "d&d 5e") {
    const questions: CharacterQuestion[] = [
      createNumberQuestion("level", "Starting level", 1, 10, 1),
      createSelectQuestion("class", "Class", [
        { value: "Barbarian", label: "Barbarian" },
        { value: "Bard", label: "Bard" },
        { value: "Cleric", label: "Cleric" },
        { value: "Druid", label: "Druid" },
        { value: "Fighter", label: "Fighter" },
        { value: "Monk", label: "Monk" },
        { value: "Paladin", label: "Paladin" },
        { value: "Ranger", label: "Ranger" },
        { value: "Rogue", label: "Rogue" },
        { value: "Sorcerer", label: "Sorcerer" },
        { value: "Warlock", label: "Warlock" },
        { value: "Wizard", label: "Wizard" },
      ]),
      createSelectQuestion("ancestry", "Ancestry", [
        { value: "Aasimar", label: "Aasimar" },
        { value: "Dragonborn", label: "Dragonborn" },
        { value: "Dwarf", label: "Dwarf" },
        { value: "Elf", label: "Elf" },
        { value: "Gnome", label: "Gnome" },
        { value: "Goliath", label: "Goliath" },
        { value: "Half-Elf", label: "Half-Elf" },
        { value: "Half-Orc", label: "Half-Orc" },
        { value: "Halfling", label: "Halfling" },
        { value: "Human", label: "Human" },
        { value: "Orc", label: "Orc" },
        { value: "Tiefling", label: "Tiefling" },
      ]),
      createSelectQuestion("heritage", "Lineage / heritage", [
        { value: "Standard", label: "Standard heritage" },
        { value: "Highborn", label: "Highborn / scholarly" },
        { value: "Woodland", label: "Woodland / swift" },
        { value: "Stout", label: "Stout / resilient" },
        { value: "Shadow-touched", label: "Shadow-touched" },
      ]),
      createNumberQuestion("str", "Strength", 8, 20, 14),
      createNumberQuestion("dex", "Dexterity", 8, 20, 12),
      createNumberQuestion("con", "Constitution", 8, 20, 13),
      createNumberQuestion("int", "Intelligence", 8, 20, 10),
      createNumberQuestion("wis", "Wisdom", 8, 20, 10),
      createNumberQuestion("cha", "Charisma", 8, 20, 10),
      createSelectQuestion("mainHand", "Main-hand weapon", [
        { value: "None", label: "None" },
        { value: "Battleaxe", label: "Battleaxe" },
        { value: "Crossbow", label: "Crossbow" },
        { value: "Dagger", label: "Dagger" },
        { value: "Greataxe", label: "Greataxe" },
        { value: "Greatsword", label: "Greatsword" },
        { value: "Longsword", label: "Longsword" },
        { value: "Longbow", label: "Longbow" },
        { value: "Mace", label: "Mace" },
        { value: "Maul", label: "Maul" },
        { value: "Rapier", label: "Rapier" },
        { value: "Quarterstaff", label: "Quarterstaff" },
        { value: "Scimitar", label: "Scimitar" },
        { value: "Shortsword", label: "Shortsword" },
        { value: "Shortbow", label: "Shortbow" },
        { value: "Spear", label: "Spear" },
      ]),
      createSelectQuestion("offHand", "Off-hand weapon", [
        { value: "None", label: "None" },
        { value: "Dagger", label: "Dagger" },
        { value: "Handaxe", label: "Handaxe" },
        { value: "Light Hammer", label: "Light Hammer" },
        { value: "Scimitar", label: "Scimitar" },
        { value: "Shortsword", label: "Shortsword" },
        { value: "Rapier", label: "Rapier" },
      ]),
      createSelectQuestion("rangedWeapon", "Ranged weapon", [
        { value: "None", label: "None" },
        { value: "Crossbow", label: "Crossbow" },
        { value: "Javelin", label: "Javelin" },
        { value: "Longbow", label: "Longbow" },
        { value: "Shortbow", label: "Shortbow" },
        { value: "Sling", label: "Sling" },
      ]),
      createSelectQuestion("armor", "Armor", [
        { value: "No Armor", label: "No Armor" },
        { value: "Leather", label: "Leather" },
        { value: "Studded Leather", label: "Studded Leather" },
        { value: "Chain Shirt", label: "Chain Shirt" },
        { value: "Scale Mail", label: "Scale Mail" },
        { value: "Breastplate", label: "Breastplate" },
        { value: "Chain Mail", label: "Chain Mail" },
        { value: "Half Plate", label: "Half Plate" },
        { value: "Plate", label: "Plate" },
      ]),
      createSelectQuestion("shieldEquipped", "Shield", [
        { value: "No", label: "No shield" },
        { value: "Yes", label: "Shield equipped" },
      ]),
      createSelectQuestion("gearKit", "Adventuring kit", [
        { value: "Burglar's Pack", label: "Burglar's Pack" },
        { value: "Diplomat's Pack", label: "Diplomat's Pack" },
        { value: "Explorer's Pack", label: "Explorer's Pack" },
        { value: "Dungeoneer's Pack", label: "Dungeoneer's Pack" },
        { value: "Priest's Pack", label: "Priest's Pack" },
        { value: "Scholar's Pack", label: "Scholar's Pack" },
      ]),
      createSelectQuestion("fightingStyle", "Fighting style", [
        { value: "Defense", label: "Defense" },
        { value: "Dueling", label: "Dueling" },
        { value: "Great Weapon Fighting", label: "Great Weapon Fighting" },
        { value: "Archery", label: "Archery" },
        { value: "Two-Weapon Fighting", label: "Two-Weapon Fighting" },
      ]),
      createSelectQuestion("rogueTalent", "Rogue focus", [
        { value: "Stealth", label: "Stealth" },
        { value: "Acrobatics", label: "Acrobatics" },
        { value: "Deception", label: "Deception" },
        { value: "Thieves' Tools", label: "Thieves' Tools" },
      ]),
      createSelectQuestion("clericDomain", "Divine domain", [
        { value: "Life", label: "Life" },
        { value: "Light", label: "Light" },
        { value: "Knowledge", label: "Knowledge" },
        { value: "Nature", label: "Nature" },
        { value: "Tempest", label: "Tempest" },
        { value: "War", label: "War" },
        { value: "Trickery", label: "Trickery" },
      ]),
      createSelectQuestion("sorcerousOrigin", "Sorcerous origin", [
        { value: "Draconic Bloodline", label: "Draconic Bloodline" },
        { value: "Wild Magic", label: "Wild Magic" },
      ]),
      createSelectQuestion("warlockPatron", "Otherworldly patron", [
        { value: "The Archfey", label: "The Archfey" },
        { value: "The Fiend", label: "The Fiend" },
        { value: "The Great Old One", label: "The Great Old One" },
      ]),
      createSelectQuestion("barbarianPath", "Primal path", [
        { value: "Berserker", label: "Path of the Berserker" },
        { value: "Totem Warrior", label: "Path of the Totem Warrior" },
      ]),
      createSelectQuestion("bardCollege", "Bardic college", [
        { value: "Lore", label: "College of Lore" },
        { value: "Valor", label: "College of Valor" },
      ]),
      createSelectQuestion("druidCircle", "Druid circle", [
        { value: "Land", label: "Circle of the Land" },
        { value: "Moon", label: "Circle of the Moon" },
      ]),
      createSelectQuestion("fighterArchetype", "Martial archetype", [
        { value: "Champion", label: "Champion" },
        { value: "Battle Master", label: "Battle Master" },
        { value: "Eldritch Knight", label: "Eldritch Knight" },
      ]),
      createSelectQuestion("monasticTradition", "Monastic tradition", [
        { value: "Open Hand", label: "Way of the Open Hand" },
        { value: "Elements", label: "Way of the Four Elements" },
        { value: "Shadow", label: "Way of Shadow" },
      ]),
      createSelectQuestion("paladinOath", "Sacred oath", [
        { value: "Devotion", label: "Oath of Devotion" },
        { value: "Ancients", label: "Oath of the Ancients" },
        { value: "Vengeance", label: "Oath of Vengeance" },
      ]),
      createSelectQuestion("rangerConclave", "Ranger conclave", [
        { value: "Hunter", label: "Hunter" },
        { value: "Beast Master", label: "Beast Master" },
      ]),
      createSelectQuestion("roguishArchetype", "Roguish archetype", [
        { value: "Thief", label: "Thief" },
        { value: "Assassin", label: "Assassin" },
        { value: "Arcane Trickster", label: "Arcane Trickster" },
      ]),
      createSelectQuestion("arcaneTradition", "Arcane tradition", [
        { value: "Evocation", label: "School of Evocation" },
        { value: "Illusion", label: "School of Illusion" },
        { value: "Divination", label: "School of Divination" },
      ]),
      createSelectQuestion("cantripOne", "Cantrip 1", getDndSpellOptions("Wizard", 0)),
      createSelectQuestion("cantripTwo", "Cantrip 2", getDndSpellOptions("Wizard", 0)),
      createSelectQuestion("cantripThree", "Cantrip 3", getDndSpellOptions("Wizard", 0)),
      createSelectQuestion("spellLevel1A", "1st-level spell 1", getDndSpellOptions("Wizard", 1)),
      createSelectQuestion("spellLevel1B", "1st-level spell 2", getDndSpellOptions("Wizard", 1)),
      createSelectQuestion("spellLevel2A", "2nd-level spell 1", getDndSpellOptions("Wizard", 2)),
      createSelectQuestion("spellLevel2B", "2nd-level spell 2", getDndSpellOptions("Wizard", 2)),
      createSelectQuestion("spellLevel3A", "3rd-level spell 1", getDndSpellOptions("Wizard", 3)),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "Background", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
    ];

    const classIs = (value: string) => (answers: Record<string, string | number | null | undefined>) =>
      getAnswerString(answers, "class", "Barbarian") === value;
    const levelAtLeast = (minimum: number) => (
      answers: Record<string, string | number | null | undefined>,
    ) => getAnswerNumber(answers, "level", 1) >= minimum;
    const isFullCaster = (
      answers: Record<string, string | number | null | undefined>,
    ) =>
      ["Bard", "Cleric", "Druid", "Sorcerer", "Warlock", "Wizard"].includes(
        getAnswerString(answers, "class", "Barbarian"),
      );
    const hasSpellcastingAtLevel = (
      answers: Record<string, string | number | null | undefined>,
    ) => {
      const selectedClass = getAnswerString(answers, "class", "Barbarian");
      const selectedLevel = getAnswerNumber(answers, "level", 1);

      if (isFullCaster(answers)) {
        return true;
      }

      return (
        (selectedClass === "Paladin" || selectedClass === "Ranger") &&
        selectedLevel >= 2
      );
    };

    return questions.map((question) => {
      if (question.id === "fightingStyle") {
        return {
          ...question,
          showWhen: (answers) =>
            ["Fighter"].includes(getAnswerString(answers, "class", "Barbarian")) ||
            (["Paladin", "Ranger"].includes(
              getAnswerString(answers, "class", "Barbarian"),
            ) &&
              levelAtLeast(2)(answers)),
        };
      }

      if (question.id === "rogueTalent") {
        return { ...question, showWhen: classIs("Rogue") };
      }

      if (question.id === "clericDomain") {
        return { ...question, showWhen: classIs("Cleric") };
      }

      if (question.id === "sorcerousOrigin") {
        return { ...question, showWhen: classIs("Sorcerer") };
      }

      if (question.id === "warlockPatron") {
        return { ...question, showWhen: classIs("Warlock") };
      }

      if (question.id === "barbarianPath") {
        return { ...question, showWhen: (answers) => classIs("Barbarian")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "bardCollege") {
        return { ...question, showWhen: (answers) => classIs("Bard")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "druidCircle") {
        return { ...question, showWhen: (answers) => classIs("Druid")(answers) && levelAtLeast(2)(answers) };
      }

      if (question.id === "fighterArchetype") {
        return { ...question, showWhen: (answers) => classIs("Fighter")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "monasticTradition") {
        return { ...question, showWhen: (answers) => classIs("Monk")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "paladinOath") {
        return { ...question, showWhen: (answers) => classIs("Paladin")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "rangerConclave") {
        return { ...question, showWhen: (answers) => classIs("Ranger")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "roguishArchetype") {
        return { ...question, showWhen: (answers) => classIs("Rogue")(answers) && levelAtLeast(3)(answers) };
      }

      if (question.id === "arcaneTradition") {
        return { ...question, showWhen: (answers) => classIs("Wizard")(answers) && levelAtLeast(2)(answers) };
      }

      if (["cantripOne", "cantripTwo", "cantripThree"].includes(question.id)) {
        const cantripIndex =
          question.id === "cantripThree" ? 3 : question.id === "cantripTwo" ? 2 : 1;

        return {
          ...question,
          showWhen: (answers) =>
            isFullCaster(answers) &&
            (cantripIndex < 3 || levelAtLeast(4)(answers)),
        };
      }

      if (["spellLevel1A", "spellLevel1B"].includes(question.id)) {
        return {
          ...question,
          showWhen: hasSpellcastingAtLevel,
        };
      }

      if (["spellLevel2A", "spellLevel2B"].includes(question.id)) {
        return {
          ...question,
          showWhen: (answers) =>
            getDndMaxSpellLevel(
              getAnswerString(answers, "class", "Wizard"),
              getAnswerNumber(answers, "level", 1),
            ) >= 2,
        };
      }

      if (question.id === "spellLevel3A") {
        return {
          ...question,
          showWhen: (answers) =>
            getDndMaxSpellLevel(
              getAnswerString(answers, "class", "Wizard"),
              getAnswerNumber(answers, "level", 1),
            ) >= 3,
        };
      }

      return question;
    });
  }

  if (normalizedRuleset === "deadlands classic") {
    const questions: CharacterQuestion[] = [
      createSelectQuestion("archetype", "Archetype", [
        { value: "Gunslinger", label: "Gunslinger" },
        { value: "Gambler", label: "Gambler" },
        { value: "Lawman", label: "Lawman" },
        { value: "Huckster", label: "Huckster" },
        { value: "Mad Scientist", label: "Mad Scientist" },
        { value: "Blessed", label: "Blessed" },
        { value: "Shaman", label: "Shaman" },
        { value: "Bounty Hunter", label: "Bounty Hunter" },
        { value: "Scout / Tracker", label: "Scout / Tracker" },
        { value: "Soldier / Cavalry", label: "Soldier / Cavalry" },
        { value: "Prospector", label: "Prospector" },
        { value: "Showman / Entertainer", label: "Showman / Entertainer" },
      ]),
      createNumberQuestion("deftness", "Deftness", 1, 5, 3),
      createNumberQuestion("nimbleness", "Nimbleness", 1, 5, 3),
      createNumberQuestion("quickness", "Quickness", 1, 5, 3),
      createNumberQuestion("strength", "Strength", 1, 5, 3),
      createNumberQuestion("vigor", "Vigor", 1, 5, 3),
      createNumberQuestion("cognition", "Cognition", 1, 5, 3),
      createNumberQuestion("knowledge", "Knowledge", 1, 5, 3),
      createNumberQuestion("mien", "Mien", 1, 5, 3),
      createNumberQuestion("smarts", "Smarts", 1, 5, 3),
      createNumberQuestion("spirit", "Spirit", 1, 5, 3),
      createSelectQuestion("primarySkill", "Primary skill", [
        { value: "Shootin'", label: "Shootin'" },
        { value: "Fightin'", label: "Fightin'" },
        { value: "Dodge", label: "Dodge" },
        { value: "Guts", label: "Guts" },
        { value: "Scrutinize", label: "Scrutinize" },
        { value: "Persuasion", label: "Persuasion" },
        { value: "Ridicule", label: "Ridicule" },
        { value: "Overawe", label: "Overawe" },
        { value: "Faith", label: "Faith" },
        { value: "Hexslingin'", label: "Hexslingin'" },
        { value: "Mad Science", label: "Mad Science" },
        { value: "Survival", label: "Survival" },
        { value: "Tracking", label: "Tracking" },
        { value: "Horse Ridin'", label: "Horse Ridin'" },
        { value: "Sneak", label: "Sneak" },
      ]),
      createSelectQuestion("secondarySkill", "Secondary skill", [
        { value: "Guts", label: "Guts" },
        { value: "Dodge", label: "Dodge" },
        { value: "Shootin'", label: "Shootin'" },
        { value: "Fightin'", label: "Fightin'" },
        { value: "Scrutinize", label: "Scrutinize" },
        { value: "Persuasion", label: "Persuasion" },
        { value: "Ridicule", label: "Ridicule" },
        { value: "Overawe", label: "Overawe" },
        { value: "Faith", label: "Faith" },
        { value: "Hexslingin'", label: "Hexslingin'" },
        { value: "Mad Science", label: "Mad Science" },
        { value: "Survival", label: "Survival" },
        { value: "Tracking", label: "Tracking" },
        { value: "Horse Ridin'", label: "Horse Ridin'" },
        { value: "Sneak", label: "Sneak" },
      ]),
      createSelectQuestion("edgeOne", "Edge 1", [
        { value: "Quick Draw", label: "Quick Draw" },
        { value: "Nerves o' Steel", label: "Nerves o' Steel" },
        { value: "Keen", label: "Keen" },
        { value: "Strong Willed", label: "Strong Willed" },
        { value: "Hard to Kill", label: "Hard to Kill" },
        { value: "Level Headed", label: "Level Headed" },
        { value: "Arcane Background", label: "Arcane Background" },
      ]),
      createSelectQuestion("edgeTwo", "Edge 2", [
        { value: "None", label: "None" },
        { value: "Quick Draw", label: "Quick Draw" },
        { value: "Nerves o' Steel", label: "Nerves o' Steel" },
        { value: "Keen", label: "Keen" },
        { value: "Strong Willed", label: "Strong Willed" },
        { value: "Hard to Kill", label: "Hard to Kill" },
        { value: "Level Headed", label: "Level Headed" },
        { value: "Arcane Background", label: "Arcane Background" },
      ]),
      createSelectQuestion("hindranceOne", "Hindrance 1", [
        { value: "Enemy", label: "Enemy" },
        { value: "Greedy", label: "Greedy" },
        { value: "Loyal", label: "Loyal" },
        { value: "Mean as a Rattler", label: "Mean as a Rattler" },
        { value: "Vengeful", label: "Vengeful" },
        { value: "Wanted", label: "Wanted" },
        { value: "Night Terrors", label: "Night Terrors" },
      ]),
      createSelectQuestion("hindranceTwo", "Hindrance 2", [
        { value: "None", label: "None" },
        { value: "Enemy", label: "Enemy" },
        { value: "Greedy", label: "Greedy" },
        { value: "Loyal", label: "Loyal" },
        { value: "Mean as a Rattler", label: "Mean as a Rattler" },
        { value: "Vengeful", label: "Vengeful" },
        { value: "Wanted", label: "Wanted" },
        { value: "Night Terrors", label: "Night Terrors" },
      ]),
      createSelectQuestion("blessedMiracleOne", "Miracle 1", [
        { value: "Smite", label: "Smite" },
        { value: "Protection", label: "Protection" },
        { value: "Healing", label: "Healing" },
        { value: "Blessed Luck", label: "Blessed Luck" },
        { value: "Sanctify", label: "Sanctify" },
      ]),
      createSelectQuestion("blessedMiracleTwo", "Miracle 2", [
        { value: "None", label: "None" },
        { value: "Smite", label: "Smite" },
        { value: "Protection", label: "Protection" },
        { value: "Healing", label: "Healing" },
        { value: "Blessed Luck", label: "Blessed Luck" },
        { value: "Sanctify", label: "Sanctify" },
      ]),
      createSelectQuestion("hucksterHexOne", "Hex 1", [
        { value: "Soul Blast", label: "Soul Blast" },
        { value: "Phantom Fingers", label: "Phantom Fingers" },
        { value: "Card Sharp", label: "Card Sharp" },
        { value: "Shadow Man", label: "Shadow Man" },
        { value: "Fortune", label: "Fortune" },
      ]),
      createSelectQuestion("hucksterHexTwo", "Hex 2", [
        { value: "None", label: "None" },
        { value: "Soul Blast", label: "Soul Blast" },
        { value: "Phantom Fingers", label: "Phantom Fingers" },
        { value: "Card Sharp", label: "Card Sharp" },
        { value: "Shadow Man", label: "Shadow Man" },
        { value: "Fortune", label: "Fortune" },
      ]),
      createSelectQuestion("shamanFavorOne", "Favor 1", [
        { value: "Spirit Warrior", label: "Spirit Warrior" },
        { value: "Medicine Ways", label: "Medicine Ways" },
        { value: "Beast Friend", label: "Beast Friend" },
        { value: "Storm Calling", label: "Storm Calling" },
        { value: "Ghost Voice", label: "Ghost Voice" },
      ]),
      createSelectQuestion("shamanFavorTwo", "Favor 2", [
        { value: "None", label: "None" },
        { value: "Spirit Warrior", label: "Spirit Warrior" },
        { value: "Medicine Ways", label: "Medicine Ways" },
        { value: "Beast Friend", label: "Beast Friend" },
        { value: "Storm Calling", label: "Storm Calling" },
        { value: "Ghost Voice", label: "Ghost Voice" },
      ]),
      createSelectQuestion("madScienceInventionOne", "Invention 1", [
        { value: "Electrostatic Projector", label: "Electrostatic Projector" },
        { value: "Ghost-Rock Analyzer", label: "Ghost-Rock Analyzer" },
        { value: "Aetheric Communicator", label: "Aetheric Communicator" },
        { value: "Clockwork Assistant", label: "Clockwork Assistant" },
        { value: "Flash Coil", label: "Flash Coil" },
      ]),
      createSelectQuestion("madScienceInventionTwo", "Invention 2", [
        { value: "None", label: "None" },
        { value: "Electrostatic Projector", label: "Electrostatic Projector" },
        { value: "Ghost-Rock Analyzer", label: "Ghost-Rock Analyzer" },
        { value: "Aetheric Communicator", label: "Aetheric Communicator" },
        { value: "Clockwork Assistant", label: "Clockwork Assistant" },
        { value: "Flash Coil", label: "Flash Coil" },
      ]),
      createNumberQuestion("arcanePool", "Arcane points / favor", 0, 10, 3),
      createSelectQuestion("mainHand", "Main hand", [
        { value: "Colt Peacemaker", label: "Colt Peacemaker" },
        { value: "Schofield Revolver", label: "Schofield Revolver" },
        { value: "Double-Action Army", label: "Double-Action Army" },
        { value: "Bow Knife", label: "Bow Knife" },
        { value: "Saber", label: "Saber" },
        { value: "Tomahawk", label: "Tomahawk" },
        { value: "Derringer", label: "Derringer" },
      ]),
      createSelectQuestion("offHand", "Off hand", [
        { value: "None", label: "None" },
        { value: "Derringer", label: "Derringer" },
        { value: "Bow Knife", label: "Bow Knife" },
        { value: "Tomahawk", label: "Tomahawk" },
        { value: "Schofield Revolver", label: "Schofield Revolver" },
      ]),
      createSelectQuestion("longarm", "Longarm", [
        { value: "None", label: "None" },
        { value: "Winchester Rifle", label: "Winchester Rifle" },
        { value: "Coach Gun", label: "Coach Gun" },
        { value: "Hunting Rifle", label: "Hunting Rifle" },
        { value: "Sawed-Off Shotgun", label: "Sawed-Off Shotgun" },
      ]),
      createNumberQuestion("guts", "Guts", 1, 5, 2),
      createNumberQuestion("woundHead", "Head wounds", 0, 4, 0),
      createNumberQuestion("woundGuts", "Guts wounds", 0, 4, 0),
      createNumberQuestion("woundLeftArm", "Left arm wounds", 0, 4, 0),
      createNumberQuestion("woundRightArm", "Right arm wounds", 0, 4, 0),
      createNumberQuestion("woundLeftLeg", "Left leg wounds", 0, 4, 0),
      createNumberQuestion("woundRightLeg", "Right leg wounds", 0, 4, 0),
      createNumberQuestion("fateWhite", "Fate chips (White)", 0, 10, 2),
      createNumberQuestion("fateRed", "Fate chips (Red)", 0, 10, 1),
      createNumberQuestion("fateBlue", "Fate chips (Blue)", 0, 10, 0),
      createNumberQuestion("fateLegend", "Fate chips (Legend)", 0, 10, 0),
      createSelectQuestion("woundIgnore", "Wound ignore source", [
        { value: "None", label: "None" },
        { value: "Arcane Background", label: "Arcane Background" },
        { value: "Nerves o' Steel", label: "Nerves o' Steel" },
        { value: "Veteran Resolve", label: "Veteran Resolve" },
      ]),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "Trouble trailing behind them", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
    ];

    const archetypeIs = (value: string) => (
      answers: Record<string, string | number | null | undefined>,
    ) => getAnswerString(answers, "archetype", "Gunslinger") === value;

    return questions.map((question) => {
      if (["blessedMiracleOne", "blessedMiracleTwo"].includes(question.id)) {
        return { ...question, showWhen: archetypeIs("Blessed") };
      }

      if (["hucksterHexOne", "hucksterHexTwo"].includes(question.id)) {
        return { ...question, showWhen: archetypeIs("Huckster") };
      }

      if (["shamanFavorOne", "shamanFavorTwo"].includes(question.id)) {
        return { ...question, showWhen: archetypeIs("Shaman") };
      }

      if (["madScienceInventionOne", "madScienceInventionTwo"].includes(question.id)) {
        return { ...question, showWhen: archetypeIs("Mad Scientist") };
      }

      if (question.id === "arcanePool") {
        return {
          ...question,
          showWhen: (answers) =>
            ["Blessed", "Huckster", "Shaman", "Mad Scientist"].includes(
              getAnswerString(answers, "archetype", "Gunslinger"),
            ),
        };
      }

      return question;
    });
  }

  if (normalizedRuleset === "savage rifts") {
    return [
      createSelectQuestion("framework", "Heroic framework", [
        { value: "Cyber-Knight", label: "Cyber-Knight" },
        { value: "M.A.R.S.", label: "M.A.R.S. operative" },
        { value: "Ley Line Walker", label: "Ley Line Walker" },
        { value: "Glitter Boy", label: "Glitter Boy" },
      ]),
      createSelectQuestion("combatRole", "Combat role", [
        { value: "frontline", label: "Frontline" },
        { value: "mobile", label: "Mobile skirmisher" },
        { value: "support", label: "Support / utility" },
      ]),
      createNumberQuestion("bennies", "Starting bennies", 1, 5, 3),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "What hard life shaped them?", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "mutants in the now") {
    return [
      createSelectQuestion("species", "Mutant species", [
        { value: "Mutant snapping turtle", label: "Mutant snapping turtle" },
        { value: "Mutant alley cat", label: "Mutant alley cat" },
        { value: "Mutant rat", label: "Mutant rat" },
        { value: "Mutant iguana", label: "Mutant iguana" },
      ]),
      createSelectQuestion("streetRole", "Street role", [
        { value: "Bruiser", label: "Bruiser" },
        { value: "Scout", label: "Scout" },
        { value: "Tinkerer", label: "Tinkerer" },
        { value: "Face", label: "Face" },
      ]),
      createNumberQuestion("ferocity", "Ferocity", 1, 5, 3),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "Crew history", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "astonishing super heroes") {
    return [
      createSelectQuestion("origin", "Power origin", [
        { value: "Mutant", label: "Mutant" },
        { value: "Cosmic", label: "Cosmic" },
        { value: "Tech", label: "Tech" },
        { value: "Mystic", label: "Mystic" },
      ]),
      createSelectQuestion("powerProfile", "Primary power profile", [
        { value: "force", label: "Force projection" },
        { value: "mobility", label: "Mobility" },
        { value: "control", label: "Control / utility" },
      ]),
      createNumberQuestion("control", "Power control", 1, 5, 3),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "Public identity or burden", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "star wars rpg") {
    return [
      createSelectQuestion("archetype", "Archetype", [
        { value: "Smuggler", label: "Smuggler" },
        { value: "Soldier", label: "Soldier" },
        { value: "Explorer", label: "Explorer" },
        { value: "Mystic", label: "Mystic" },
      ]),
      createSelectQuestion("specialty", "Core specialty", [
        { value: "Piloting", label: "Piloting" },
        { value: "Negotiation", label: "Negotiation" },
        { value: "Ranged Light", label: "Ranged Light" },
        { value: "Mechanics", label: "Mechanics" },
      ]),
      createNumberQuestion("forceAffinity", "Force affinity", 0, 5, 1),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "What debt, duty, or cause drives them?", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "legend of 5 rings 4e") {
    return [
      createSelectQuestion("clan", "Clan", [
        { value: "Crab", label: "Crab" },
        { value: "Crane", label: "Crane" },
        { value: "Dragon", label: "Dragon" },
        { value: "Lion", label: "Lion" },
        { value: "Phoenix", label: "Phoenix" },
        { value: "Ronin", label: "Ronin" },
      ]),
      createSelectQuestion("school", "School", [
        { value: "Bushi", label: "Bushi" },
        { value: "Courtier", label: "Courtier" },
        { value: "Shugenja", label: "Shugenja" },
        { value: "Scout", label: "Scout" },
      ]),
      createSelectQuestion("ringFocus", "Strongest ring", [
        { value: "air", label: "Air" },
        { value: "earth", label: "Earth" },
        { value: "fire", label: "Fire" },
        { value: "water", label: "Water" },
        { value: "void", label: "Void" },
      ]),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "Duty or personal conflict", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "vampire: the masqureade v5") {
    return [
      createSelectQuestion("clan", "Clan", [
        { value: "Brujah", label: "Brujah" },
        { value: "Toreador", label: "Toreador" },
        { value: "Nosferatu", label: "Nosferatu" },
        { value: "Ventrue", label: "Ventrue" },
      ]),
      createSelectQuestion("predatorType", "Predator style", [
        { value: "Alleycat", label: "Alleycat" },
        { value: "Consensualist", label: "Consensualist" },
        { value: "Scene Queen", label: "Scene Queen" },
        { value: "Sandman", label: "Sandman" },
      ]),
      createNumberQuestion("humanity", "Starting humanity", 4, 8, 6),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "What still anchors their human side?", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  if (normalizedRuleset === "call of cthulhu") {
    return [
      createSelectQuestion("occupation", "Occupation", [
        { value: "Journalist", label: "Journalist" },
        { value: "Professor", label: "Professor" },
        { value: "Antiquarian", label: "Antiquarian" },
        { value: "Detective", label: "Detective" },
        { value: "Doctor", label: "Doctor" },
      ]),
      createSelectQuestion("bestSkill", "Best skill", [
        { value: "Library Use", label: "Library Use" },
        { value: "Spot Hidden", label: "Spot Hidden" },
        { value: "Persuade", label: "Persuade" },
        { value: "Firearms", label: "Firearms" },
      ]),
      createNumberQuestion("nerve", "Nerve / steadiness", 1, 5, 3),
      createAgeQuestion(),
      createGenderQuestion(),
      createTextareaQuestion("background", "What truth are they chasing?", "", undefined, 8000),
      createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
      createTextareaQuestion("personality", "Personality", "", undefined, 5000),
      ];
  }

  return [
    createSelectQuestion("role", "Role", [
      { value: "Adventurer", label: "Adventurer" },
      { value: "Scholar", label: "Scholar" },
      { value: "Warrior", label: "Warrior" },
    ]),
    createNumberQuestion("competence", "Competence", 1, 5, 3),
    createSelectQuestion("startingEquipment", "Starting equipment", [
      { value: "Travel gear", label: "Travel gear" },
      { value: "Combat kit", label: "Combat kit" },
      { value: "Research tools", label: "Research tools" },
    ]),
    createSelectQuestion("startingSpell", "Signature spell or trick", [
      { value: "None", label: "None" },
      { value: "Utility cantrip", label: "Utility cantrip" },
      { value: "Combat trick", label: "Combat trick" },
      { value: "Protective ward", label: "Protective ward" },
    ]),
    createAgeQuestion(),
    createGenderQuestion(),
    createTextareaQuestion("background", "Background", "", undefined, 8000),
    createTextareaQuestion("physicalDescription", "Physical description", "", undefined, 3000),
    createTextareaQuestion("personality", "Personality", "", undefined, 5000),
  ];
}

function isQuestionVisible(
  question: CharacterQuestion,
  answers: Record<string, string | number | null | undefined>,
) {
  return question.showWhen ? question.showWhen(answers) : true;
}

export function getVisibleCharacterQuestions(
  ruleset: string,
  answers: Record<string, string | number | null | undefined>,
) {
  const questions = getCharacterQuestionnaire(ruleset);
  const normalizedRuleset = normalizeRuleset(ruleset);

  return questions
    .filter((question) => isQuestionVisible(question, answers))
    .map((question) => {
      if (normalizedRuleset !== "d&d 5e") {
        return question;
      }

      const selectedClass = getAnswerString(answers, "class", "Wizard");
      const spellVerb = isDndPreparedCaster(selectedClass) ? "Prepared" : "Known";

      if (["cantripOne", "cantripTwo", "cantripThree"].includes(question.id)) {
        return {
          ...question,
          options: getDndSpellOptions(selectedClass, 0),
        };
      }

      if (["spellLevel1A", "spellLevel1B"].includes(question.id)) {
        return {
          ...question,
          label: `${spellVerb} 1st-level spell ${question.id.endsWith("B") ? "2" : "1"}`,
          options: getDndSpellOptions(selectedClass, 1),
        };
      }

      if (["spellLevel2A", "spellLevel2B"].includes(question.id)) {
        return {
          ...question,
          label: `${spellVerb} 2nd-level spell ${question.id.endsWith("B") ? "2" : "1"}`,
          options: getDndSpellOptions(selectedClass, 2),
        };
      }

      if (question.id === "spellLevel3A") {
        return {
          ...question,
          label: `${spellVerb} 3rd-level spell 1`,
          options: getDndSpellOptions(selectedClass, 3),
        };
      }

      return question;
    });
}

function getAnswerString(
  answers: Record<string, string | number | null | undefined>,
  key: string,
  fallback = "",
) {
  const value = answers[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getAnswerNumber(
  answers: Record<string, string | number | null | undefined>,
  key: string,
  fallback: number,
) {
  const value = answers[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function buildPersonalityText(
  answers: Record<string, string | number | null | undefined>,
) {
  return (
    getAnswerString(answers, "personality", "").replace(/[.?!\s]+$/g, "") ||
    "steady, adaptable, and expressive under pressure"
  );
}

function buildPhysicalDescriptionText(
  answers: Record<string, string | number | null | undefined>,
) {
  return (
    getAnswerString(answers, "physicalDescription", "").trim() ||
    "Not specified."
  );
}

function buildPortraitDataUrl(
  answers: Record<string, string | number | null | undefined>,
) {
  const value = answers.portraitDataUrl;
  return typeof value === "string" && value.startsWith("data:image/")
    ? value
    : "";
}

function compactBehaviorText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "";
  }

  const sentenceMatch = cleaned.match(/^(.{1,220}?[.!?])(?:\s|$)/);
  const baseValue = sentenceMatch?.[1]?.trim() || cleaned;

  if (baseValue.length <= maxLength) {
    return baseValue;
  }

  return `${baseValue.slice(0, maxLength - 3).trim()}...`;
}

export function deriveBehaviorSummary(
  sheetJson: unknown,
  characterName = "This character",
  fallbackMemorySummary?: string | null,
) {
  const typedSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? (sheetJson as Record<string, unknown>)
      : {};

  const identityParts = [
    typeof typedSheet.ancestry === "string" ? typedSheet.ancestry.trim() : "",
    typeof typedSheet.class === "string"
      ? typedSheet.class.trim()
      : typeof typedSheet.archetype === "string"
        ? typedSheet.archetype.trim()
        : typeof typedSheet.role === "string"
          ? typedSheet.role.trim()
          : typeof typedSheet.occupation === "string"
            ? typedSheet.occupation.trim()
            : "",
  ].filter(Boolean);
  const physicalSnippet = compactBehaviorText(typedSheet.physicalDescription, 140);
  const backgroundSnippet = compactBehaviorText(typedSheet.background, 180);
  const personalitySnippet = compactBehaviorText(typedSheet.personality, 180);
  const summaryParts = [
    identityParts.length > 0
      ? `${characterName} is a ${identityParts.join(" ")}.`
      : "",
    physicalSnippet ? `Looks: ${physicalSnippet}` : "",
    backgroundSnippet ? `Background: ${backgroundSnippet}` : "",
    personalitySnippet ? `Behavior: ${personalitySnippet}` : "",
  ].filter(Boolean);

  if (summaryParts.length === 0) {
    const compactMemory = compactBehaviorText(fallbackMemorySummary, 220);
    return compactMemory || `${characterName} is defined by a steady but still-evolving history.`;
  }

  return summaryParts.join(" ");
}

export function deriveBehaviorDirectives(sheetJson: unknown): string[] {
  const typedSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? (sheetJson as Record<string, unknown>)
      : {};
  const personalityText =
    typeof typedSheet.personality === "string"
      ? typedSheet.personality.trim()
      : "";
  const behaviorSummary =
    typeof typedSheet.behaviorSummary === "string"
      ? typedSheet.behaviorSummary.trim()
      : "";
  const source = `${personalityText} ${behaviorSummary}`.toLowerCase();
  const directives: string[] = [];
  const pushDirective = (value: string) => {
    if (!directives.includes(value)) {
      directives.push(value);
    }
  };

  if (!source) {
    return [];
  }

  if (/\b(cautious|careful|wary|methodical|measured|risk-averse)\b/.test(source)) {
    pushDirective("Prefer caution and verify risks before committing.");
  }
  if (/\b(reckless|impulsive|brash|hot-headed|headstrong|bold)\b/.test(source)) {
    pushDirective("Act decisively and accept risk rather than over-planning.");
  }
  if (/\b(blunt|direct|plainspoken|straightforward)\b/.test(source)) {
    pushDirective("Speak bluntly and directly; avoid flowery phrasing.");
  }
  if (/\b(formal|courtly|polite|respectful|diplomatic)\b/.test(source)) {
    pushDirective("Maintain formal, respectful speech even under pressure.");
  }
  if (/\b(sarcastic|witty|dry humor|snarky)\b/.test(source)) {
    pushDirective("Use dry wit or sharp sarcasm in dialogue.");
  }
  if (/\b(quiet|reserved|guarded|secretive|stoic)\b/.test(source)) {
    pushDirective("Keep statements concise and reveal little unless necessary.");
  }
  if (/\b(loyal|protective|selfless|self-sacrificing)\b/.test(source)) {
    pushDirective("Prioritize ally safety and loyalty over personal gain.");
  }
  if (/\b(self-serving|greedy|opportunistic|ambitious)\b/.test(source)) {
    pushDirective("Prioritize leverage, reward, or personal advantage.");
  }
  if (/\b(curious|scholarly|analytical|inquisitive|investigative)\b/.test(source)) {
    pushDirective("Ask probing questions and focus on clues and details.");
  }
  if (/\b(vengeful|ruthless|cold|merciless)\b/.test(source)) {
    pushDirective("Favor hardline or uncompromising responses to threats.");
  }

  return directives.slice(0, 5);
}

export function withDerivedBehaviorSummary(
  sheetJson: unknown,
  characterName = "This character",
  fallbackMemorySummary?: string | null,
) {
  const typedSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? ({ ...(sheetJson as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  typedSheet.behaviorSummary = deriveBehaviorSummary(
    typedSheet,
    characterName,
    fallbackMemorySummary,
  );
  typedSheet.behaviorDirectives = deriveBehaviorDirectives(typedSheet);

  return typedSheet;
}

function appendPersonalitySummary(summary: string, personalityText: string) {
  return `${summary} Personality: ${personalityText}.`;
}

function finalizeGeneratedCharacter(character: StarterCharacter) {
  return {
    ...character,
    sheetJson: withDerivedBehaviorSummary(
      character.sheetJson,
      character.name,
      character.memorySummary,
    ),
  };
}

function chaMod(stats: {
  cha: number;
}) {
  return Math.floor((stats.cha - 10) / 2);
}

function hasDndSpellcastingSlots(characterClass: string, level: number) {
  if (["Bard", "Cleric", "Druid", "Sorcerer", "Warlock", "Wizard"].includes(characterClass)) {
    return true;
  }

  return ["Paladin", "Ranger"].includes(characterClass) && level >= 2;
}

function buildDndSpellSlots(characterClass: string, level: number) {
  if (characterClass === "Warlock") {
    return finalizeGeneratedCharacter({
      pact: level >= 2 ? 2 : 1,
      slotLevel: level >= 3 ? 2 : 1,
    });
  }

  if (["Paladin", "Ranger"].includes(characterClass)) {
    return level >= 5 ? { level1: 4, level2: 2 } : { level1: 2 };
  }

  if (level >= 5) {
    return { level1: 4, level2: 3, level3: 2 };
  }

  if (level >= 3) {
    return { level1: 4, level2: 2 };
  }

  if (level >= 2) {
    return { level1: 3 };
  }

  return { level1: 2 };
}

function getDndMaxSpellLevel(characterClass: string, level: number) {
  if (["Paladin", "Ranger"].includes(characterClass)) {
    if (level >= 9) {
      return 3;
    }
    if (level >= 5) {
      return 2;
    }
    if (level >= 2) {
      return 1;
    }
    return 0;
  }

  if (!hasDndSpellcastingSlots(characterClass, level)) {
    return 0;
  }

  if (level >= 5) {
    return 3;
  }

  if (level >= 3) {
    return 2;
  }

  return 1;
}

function isDndPreparedCaster(characterClass: string) {
  return ["Cleric", "Druid", "Paladin"].includes(characterClass);
}

function getDndSpellOptions(
  characterClass: string,
  spellLevel: 0 | 1 | 2 | 3,
): CharacterQuestionOption[] {
  const spellMap: Record<string, Record<number, CharacterQuestionOption[]>> = {
    Bard: {
      0: [
        { value: "Vicious Mockery", label: "Vicious Mockery" },
        { value: "Mage Hand", label: "Mage Hand" },
        { value: "Minor Illusion", label: "Minor Illusion" },
        { value: "Message", label: "Message" },
      ],
      1: [
        { value: "Charm Person", label: "Charm Person" },
        { value: "Dissonant Whispers", label: "Dissonant Whispers" },
        { value: "Faerie Fire", label: "Faerie Fire" },
        { value: "Healing Word", label: "Healing Word" },
      ],
      2: [
        { value: "Calm Emotions", label: "Calm Emotions" },
        { value: "Detect Thoughts", label: "Detect Thoughts" },
        { value: "Hold Person", label: "Hold Person" },
        { value: "Shatter", label: "Shatter" },
      ],
      3: [
        { value: "Dispel Magic", label: "Dispel Magic" },
        { value: "Hypnotic Pattern", label: "Hypnotic Pattern" },
        { value: "Leomund's Tiny Hut", label: "Leomund's Tiny Hut" },
      ],
    },
    Cleric: {
      0: [
        { value: "Guidance", label: "Guidance" },
        { value: "Light", label: "Light" },
        { value: "Resistance", label: "Resistance" },
        { value: "Sacred Flame", label: "Sacred Flame" },
      ],
      1: [
        { value: "Bless", label: "Bless" },
        { value: "Command", label: "Command" },
        { value: "Cure Wounds", label: "Cure Wounds" },
        { value: "Guiding Bolt", label: "Guiding Bolt" },
        { value: "Healing Word", label: "Healing Word" },
      ],
      2: [
        { value: "Aid", label: "Aid" },
        { value: "Lesser Restoration", label: "Lesser Restoration" },
        { value: "Prayer of Healing", label: "Prayer of Healing" },
        { value: "Spiritual Weapon", label: "Spiritual Weapon" },
      ],
      3: [
        { value: "Beacon of Hope", label: "Beacon of Hope" },
        { value: "Daylight", label: "Daylight" },
        { value: "Dispel Magic", label: "Dispel Magic" },
        { value: "Spirit Guardians", label: "Spirit Guardians" },
      ],
    },
    Druid: {
      0: [
        { value: "Druidcraft", label: "Druidcraft" },
        { value: "Guidance", label: "Guidance" },
        { value: "Produce Flame", label: "Produce Flame" },
        { value: "Shillelagh", label: "Shillelagh" },
      ],
      1: [
        { value: "Cure Wounds", label: "Cure Wounds" },
        { value: "Entangle", label: "Entangle" },
        { value: "Faerie Fire", label: "Faerie Fire" },
        { value: "Thunderwave", label: "Thunderwave" },
      ],
      2: [
        { value: "Flaming Sphere", label: "Flaming Sphere" },
        { value: "Heat Metal", label: "Heat Metal" },
        { value: "Moonbeam", label: "Moonbeam" },
        { value: "Pass without Trace", label: "Pass without Trace" },
      ],
      3: [
        { value: "Call Lightning", label: "Call Lightning" },
        { value: "Dispel Magic", label: "Dispel Magic" },
        { value: "Plant Growth", label: "Plant Growth" },
      ],
    },
    Paladin: {
      1: [
        { value: "Bless", label: "Bless" },
        { value: "Command", label: "Command" },
        { value: "Cure Wounds", label: "Cure Wounds" },
        { value: "Shield of Faith", label: "Shield of Faith" },
      ],
      2: [
        { value: "Find Steed", label: "Find Steed" },
        { value: "Lesser Restoration", label: "Lesser Restoration" },
        { value: "Magic Weapon", label: "Magic Weapon" },
        { value: "Zone of Truth", label: "Zone of Truth" },
      ],
      3: [
        { value: "Aura of Vitality", label: "Aura of Vitality" },
        { value: "Crusader's Mantle", label: "Crusader's Mantle" },
        { value: "Revivify", label: "Revivify" },
      ],
    },
    Ranger: {
      1: [
        { value: "Cure Wounds", label: "Cure Wounds" },
        { value: "Ensnaring Strike", label: "Ensnaring Strike" },
        { value: "Hail of Thorns", label: "Hail of Thorns" },
        { value: "Hunter's Mark", label: "Hunter's Mark" },
      ],
      2: [
        { value: "Lesser Restoration", label: "Lesser Restoration" },
        { value: "Pass without Trace", label: "Pass without Trace" },
        { value: "Spike Growth", label: "Spike Growth" },
      ],
      3: [
        { value: "Conjure Animals", label: "Conjure Animals" },
        { value: "Lightning Arrow", label: "Lightning Arrow" },
        { value: "Speak with Plants", label: "Speak with Plants" },
      ],
    },
    Sorcerer: {
      0: [
        { value: "Fire Bolt", label: "Fire Bolt" },
        { value: "Mage Hand", label: "Mage Hand" },
        { value: "Minor Illusion", label: "Minor Illusion" },
        { value: "Ray of Frost", label: "Ray of Frost" },
      ],
      1: [
        { value: "Burning Hands", label: "Burning Hands" },
        { value: "Charm Person", label: "Charm Person" },
        { value: "Magic Missile", label: "Magic Missile" },
        { value: "Shield", label: "Shield" },
      ],
      2: [
        { value: "Blur", label: "Blur" },
        { value: "Mirror Image", label: "Mirror Image" },
        { value: "Misty Step", label: "Misty Step" },
        { value: "Scorching Ray", label: "Scorching Ray" },
      ],
      3: [
        { value: "Counterspell", label: "Counterspell" },
        { value: "Fireball", label: "Fireball" },
        { value: "Fly", label: "Fly" },
      ],
    },
    Warlock: {
      0: [
        { value: "Eldritch Blast", label: "Eldritch Blast" },
        { value: "Mage Hand", label: "Mage Hand" },
        { value: "Minor Illusion", label: "Minor Illusion" },
        { value: "Prestidigitation", label: "Prestidigitation" },
      ],
      1: [
        { value: "Armor of Agathys", label: "Armor of Agathys" },
        { value: "Charm Person", label: "Charm Person" },
        { value: "Hex", label: "Hex" },
        { value: "Witch Bolt", label: "Witch Bolt" },
      ],
      2: [
        { value: "Darkness", label: "Darkness" },
        { value: "Hold Person", label: "Hold Person" },
        { value: "Invisibility", label: "Invisibility" },
        { value: "Misty Step", label: "Misty Step" },
      ],
      3: [
        { value: "Counterspell", label: "Counterspell" },
        { value: "Fear", label: "Fear" },
        { value: "Hunger of Hadar", label: "Hunger of Hadar" },
      ],
    },
    Wizard: {
      0: [
        { value: "Fire Bolt", label: "Fire Bolt" },
        { value: "Light", label: "Light" },
        { value: "Mage Hand", label: "Mage Hand" },
        { value: "Minor Illusion", label: "Minor Illusion" },
        { value: "Prestidigitation", label: "Prestidigitation" },
        { value: "Ray of Frost", label: "Ray of Frost" },
      ],
      1: [
        { value: "Detect Magic", label: "Detect Magic" },
        { value: "Mage Armor", label: "Mage Armor" },
        { value: "Magic Missile", label: "Magic Missile" },
        { value: "Shield", label: "Shield" },
        { value: "Sleep", label: "Sleep" },
      ],
      2: [
        { value: "Invisibility", label: "Invisibility" },
        { value: "Mirror Image", label: "Mirror Image" },
        { value: "Misty Step", label: "Misty Step" },
        { value: "Scorching Ray", label: "Scorching Ray" },
      ],
      3: [
        { value: "Counterspell", label: "Counterspell" },
        { value: "Dispel Magic", label: "Dispel Magic" },
        { value: "Fireball", label: "Fireball" },
        { value: "Fly", label: "Fly" },
      ],
    },
  };

  const classOptions = spellMap[characterClass]?.[spellLevel] ?? [];
  return [{ value: "None", label: "None" }, ...classOptions];
}

export function validateCharacterAnswers(
  ruleset: string,
  answers: Record<string, string | number | null | undefined>,
) {
  return validateCharacterAnswersDetailed(ruleset, answers).formError;
}

export type CharacterValidationResult = {
  formError: string;
  fieldErrors: Record<string, string>;
};

export function validateCharacterAnswersDetailed(
  ruleset: string,
  answers: Record<string, string | number | null | undefined>,
): CharacterValidationResult {
  const sanitizedAnswers = sanitizeCharacterAnswersForLimits(answers);
  const normalizedRuleset = normalizeRuleset(ruleset);
  const questions = getVisibleCharacterQuestions(ruleset, sanitizedAnswers);
  const fieldErrors: Record<string, string> = {};

  const setFieldError = (fieldId: string, message: string) => {
    if (!fieldErrors[fieldId]) {
      fieldErrors[fieldId] = message;
    }
  };

  for (const question of questions) {
    const rawValue = sanitizedAnswers[question.id];

    if (question.required) {
      if (question.kind === "number") {
        if (
          typeof rawValue !== "number" &&
          !(typeof rawValue === "string" && rawValue.trim())
        ) {
          setFieldError(question.id, `${question.label} is required`);
        }
      } else if (!(typeof rawValue === "string" && rawValue.trim())) {
        setFieldError(question.id, `${question.label} is required`);
      }
    }

      if (question.kind === "select" && typeof rawValue === "string" && question.options) {
        const validValues = question.options.map((option) => option.value);
        if (rawValue && !validValues.includes(rawValue)) {
          setFieldError(question.id, `${question.label} is invalid`);
        }
      }

      if (
        question.kind === "textarea" &&
        typeof rawValue === "string" &&
        question.maxLength &&
        rawValue.length > question.maxLength
      ) {
        setFieldError(question.id, `${question.label} is too long`);
      }

      if (question.kind === "number") {
      const numericValue = getAnswerNumber(
        answers,
        question.id,
        typeof question.defaultValue === "number" ? question.defaultValue : 0,
      );

      if (
        typeof question.min === "number" &&
        numericValue < question.min
      ) {
        setFieldError(question.id, `${question.label} is too low`);
      }

      if (
        typeof question.max === "number" &&
        numericValue > question.max
      ) {
        setFieldError(question.id, `${question.label} is too high`);
      }
    }
  }

  if (normalizedRuleset === "deadlands classic") {
    const traitKeys = [
      "deftness",
      "nimbleness",
      "quickness",
      "strength",
      "vigor",
      "cognition",
      "knowledge",
      "mien",
      "smarts",
      "spirit",
    ] as const;
    const traitValues = traitKeys.map((key) => getAnswerNumber(answers, key, 3));
    const traitTotal = traitValues.reduce((total, value) => total + value, 0);

    // Phase B baseline budget: keep novice traits in a bounded range.
    if (traitTotal > 34) {
      setFieldError(
        "deftness",
        "Deadlands trait total is too high (maximum 34 for novice builds)",
      );
    }

    if (traitTotal < 24) {
      setFieldError(
        "deftness",
        "Deadlands trait total is too low (minimum 24 for novice builds)",
      );
    }

    const archetype = getAnswerString(answers, "archetype", "Gunslinger");
    const edgeOne = getAnswerString(
      answers,
      "edgeOne",
      getAnswerString(answers, "bestEdge", "Quick Draw"),
    );
    const edgeTwo = getAnswerString(answers, "edgeTwo", "None");
    const hindranceOne = getAnswerString(
      answers,
      "hindranceOne",
      getAnswerString(answers, "hindrance", "Enemy"),
    );
    const hindranceTwo = getAnswerString(answers, "hindranceTwo", "None");
    const selectedEdges = [edgeOne, edgeTwo]
      .map((value) => value.trim())
      .filter((value) => value && value !== "None");
    const selectedHindrances = [hindranceOne, hindranceTwo]
      .map((value) => value.trim())
      .filter((value) => value && value !== "None");
    const blessedMiracleOne = getAnswerString(answers, "blessedMiracleOne", "Smite");
    const blessedMiracleTwo = getAnswerString(answers, "blessedMiracleTwo", "None");
    const hucksterHexOne = getAnswerString(answers, "hucksterHexOne", "Soul Blast");
    const hucksterHexTwo = getAnswerString(answers, "hucksterHexTwo", "None");
    const shamanFavorOne = getAnswerString(answers, "shamanFavorOne", "Spirit Warrior");
    const shamanFavorTwo = getAnswerString(answers, "shamanFavorTwo", "None");
    const madScienceInventionOne = getAnswerString(
      answers,
      "madScienceInventionOne",
      "Electrostatic Projector",
    );
    const madScienceInventionTwo = getAnswerString(answers, "madScienceInventionTwo", "None");
    const arcanePool = getAnswerNumber(answers, "arcanePool", 3);
    const primarySkill = getAnswerString(answers, "primarySkill", "Shootin'");
    const secondarySkill = getAnswerString(answers, "secondarySkill", "Guts");
    const guts = getAnswerNumber(answers, "guts", 2);

    if (primarySkill === secondarySkill) {
      setFieldError("primarySkill", "Primary and secondary skills must be different");
      setFieldError("secondarySkill", "Primary and secondary skills must be different");
    }

    const arcaneArchetypes = new Set([
      "Huckster",
      "Blessed",
      "Shaman",
      "Mad Scientist",
    ]);

    if (selectedEdges.length < 1) {
      setFieldError("edgeOne", "At least one edge is required");
    }

    if (new Set(selectedEdges).size !== selectedEdges.length) {
      setFieldError("edgeOne", "Duplicate edges are not allowed");
      setFieldError("edgeTwo", "Duplicate edges are not allowed");
    }

    if (new Set(selectedHindrances).size !== selectedHindrances.length) {
      setFieldError("hindranceOne", "Duplicate hindrances are not allowed");
      setFieldError("hindranceTwo", "Duplicate hindrances are not allowed");
    }

    if (selectedHindrances.length < 1) {
      setFieldError("hindranceOne", "At least one hindrance is required");
    }

    if (selectedEdges.includes("Arcane Background") && !arcaneArchetypes.has(archetype)) {
      setFieldError("edgeOne", "Arcane Background is only valid for arcane archetypes");
      setFieldError("edgeTwo", "Arcane Background is only valid for arcane archetypes");
    }

    if (!selectedEdges.includes("Arcane Background") && arcaneArchetypes.has(archetype)) {
      setFieldError("edgeOne", `${archetype} requires Arcane Background`);
    }

    const requiredSkillByArchetype: Record<string, string> = {
      Blessed: "Faith",
      Shaman: "Faith",
      Huckster: "Hexslingin'",
      "Mad Scientist": "Mad Science",
    };
    const requiredSkill = requiredSkillByArchetype[archetype];
    if (
      requiredSkill &&
      primarySkill !== requiredSkill &&
      secondarySkill !== requiredSkill
    ) {
      const message = `${archetype} must take ${requiredSkill} as a primary or secondary skill`;
      setFieldError("primarySkill", message);
      setFieldError("secondarySkill", message);
    }

    const selectedArcanePowers =
      archetype === "Blessed"
        ? [blessedMiracleOne, blessedMiracleTwo]
        : archetype === "Huckster"
          ? [hucksterHexOne, hucksterHexTwo]
          : archetype === "Shaman"
            ? [shamanFavorOne, shamanFavorTwo]
            : archetype === "Mad Scientist"
              ? [madScienceInventionOne, madScienceInventionTwo]
              : [];
    const distinctArcanePowers = selectedArcanePowers
      .map((value) => value.trim())
      .filter((value) => value && value !== "None");
    if (arcaneArchetypes.has(archetype)) {
      if (distinctArcanePowers.length < 1) {
        if (archetype === "Blessed") {
          setFieldError("blessedMiracleOne", "Blessed requires at least one miracle");
        } else if (archetype === "Huckster") {
          setFieldError("hucksterHexOne", "Huckster requires at least one hex");
        } else if (archetype === "Shaman") {
          setFieldError("shamanFavorOne", "Shaman requires at least one favor");
        } else if (archetype === "Mad Scientist") {
          setFieldError("madScienceInventionOne", "Mad Scientist requires at least one invention");
        }
      }

      if (new Set(distinctArcanePowers).size !== distinctArcanePowers.length) {
        if (archetype === "Blessed") {
          setFieldError("blessedMiracleTwo", "Duplicate miracles are not allowed");
        } else if (archetype === "Huckster") {
          setFieldError("hucksterHexTwo", "Duplicate hexes are not allowed");
        } else if (archetype === "Shaman") {
          setFieldError("shamanFavorTwo", "Duplicate favors are not allowed");
        } else if (archetype === "Mad Scientist") {
          setFieldError("madScienceInventionTwo", "Duplicate inventions are not allowed");
        }
      }

      if (arcanePool < 1) {
        setFieldError("arcanePool", "Arcane archetypes require at least 1 arcane point");
      }
    }

    const legalHindrances = new Set([
      "Enemy",
      "Greedy",
      "Loyal",
      "Mean as a Rattler",
      "Vengeful",
      "Wanted",
      "Night Terrors",
    ]);
    for (const hindrance of selectedHindrances) {
      if (!legalHindrances.has(hindrance)) {
        setFieldError("hindranceOne", "Selected hindrance is invalid");
      }
    }

    if (
      selectedHindrances.includes("Loyal") &&
      selectedHindrances.includes("Mean as a Rattler")
    ) {
      setFieldError("hindranceOne", "Loyal cannot be combined with Mean as a Rattler");
      setFieldError("hindranceTwo", "Loyal cannot be combined with Mean as a Rattler");
    }

    if (archetype === "Lawman" && selectedHindrances.includes("Wanted")) {
      setFieldError("hindranceOne", "Lawman cannot take Wanted");
      setFieldError("hindranceTwo", "Lawman cannot take Wanted");
    }

    const woundIgnore = getAnswerString(answers, "woundIgnore", "None");
    const woundHead = getAnswerNumber(answers, "woundHead", 0);
    const woundGuts = getAnswerNumber(answers, "woundGuts", 0);
    const woundLeftArm = getAnswerNumber(answers, "woundLeftArm", 0);
    const woundRightArm = getAnswerNumber(answers, "woundRightArm", 0);
    const woundLeftLeg = getAnswerNumber(answers, "woundLeftLeg", 0);
    const woundRightLeg = getAnswerNumber(answers, "woundRightLeg", 0);
    const locationWounds = [
      ["woundHead", woundHead],
      ["woundGuts", woundGuts],
      ["woundLeftArm", woundLeftArm],
      ["woundRightArm", woundRightArm],
      ["woundLeftLeg", woundLeftLeg],
      ["woundRightLeg", woundRightLeg],
    ] as const;
    const fateWhite = getAnswerNumber(answers, "fateWhite", 2);
    const fateRed = getAnswerNumber(answers, "fateRed", 1);
    const fateBlue = getAnswerNumber(answers, "fateBlue", 0);
    const fateLegend = getAnswerNumber(answers, "fateLegend", 0);
    const fateChipValues = [
      ["fateWhite", fateWhite],
      ["fateRed", fateRed],
      ["fateBlue", fateBlue],
      ["fateLegend", fateLegend],
    ] as const;

    for (const [fieldId, value] of locationWounds) {
      if (value < 0 || value > 4) {
        setFieldError(fieldId, "Wound values must be between 0 and 4");
      }
    }
    for (const [fieldId, value] of fateChipValues) {
      if (value < 0 || value > 10) {
        setFieldError(fieldId, "Fate chip values must be between 0 and 10");
      }
    }

    if (woundIgnore === "Nerves o' Steel" && !selectedEdges.includes("Nerves o' Steel")) {
      setFieldError(
        "woundIgnore",
        "Nerves o' Steel wound ignore requires the Nerves o' Steel edge",
      );
    }

    if (woundIgnore === "Veteran Resolve" && guts < 4) {
      setFieldError("woundIgnore", "Veteran Resolve wound ignore requires Guts 4+");
    }
  }

  const firstError = Object.values(fieldErrors)[0] ?? "";

  return {
    formError: firstError,
    fieldErrors,
  };
}

export function buildGeneratedCharacter(
  ruleset: string,
  name: string,
  answers: Record<string, string | number | null | undefined>,
): StarterCharacter {
  const sanitizedAnswers = sanitizeCharacterAnswersForLimits(answers);
  const normalizedRuleset = normalizeRuleset(ruleset);
  const cleanName = name.trim() || "Main Character";
  const background = getAnswerString(sanitizedAnswers, "background", "");
    const backgroundText = background || "A capable figure stepping into danger.";
    const physicalDescriptionText = buildPhysicalDescriptionText(sanitizedAnswers);
    const portraitDataUrl = buildPortraitDataUrl(sanitizedAnswers);
    const personalityText = buildPersonalityText(sanitizedAnswers);
    const age = getAnswerNumber(sanitizedAnswers, "age", 30);
    const gender = getAnswerString(sanitizedAnswers, "gender", "Other");

  if (normalizedRuleset === "d&d 5e") {
    const level = getAnswerNumber(answers, "level", 1);
    const characterClass = getAnswerString(answers, "class", "Fighter");
    const ancestry = getAnswerString(answers, "ancestry", "Human");
    const heritage = getAnswerString(answers, "heritage", "Standard");
    const stats = {
      str: getAnswerNumber(answers, "str", 14),
      dex: getAnswerNumber(answers, "dex", 12),
      con: getAnswerNumber(answers, "con", 13),
      int: getAnswerNumber(answers, "int", 10),
      wis: getAnswerNumber(answers, "wis", 10),
      cha: getAnswerNumber(answers, "cha", 10),
    };
    const fightingStyle = getAnswerString(answers, "fightingStyle", "Defense");
    const rogueTalent = getAnswerString(answers, "rogueTalent", "Stealth");
    const clericDomain = getAnswerString(answers, "clericDomain", "Life");
    const sorcerousOrigin = getAnswerString(
      answers,
      "sorcerousOrigin",
      "Draconic Bloodline",
    );
    const warlockPatron = getAnswerString(answers, "warlockPatron", "The Fiend");
    const barbarianPath = getAnswerString(answers, "barbarianPath", "Berserker");
    const bardCollege = getAnswerString(answers, "bardCollege", "Lore");
    const druidCircle = getAnswerString(answers, "druidCircle", "Land");
    const fighterArchetype = getAnswerString(
      answers,
      "fighterArchetype",
      "Champion",
    );
    const monasticTradition = getAnswerString(
      answers,
      "monasticTradition",
      "Open Hand",
    );
    const paladinOath = getAnswerString(answers, "paladinOath", "Devotion");
    const rangerConclave = getAnswerString(
      answers,
      "rangerConclave",
      "Hunter",
    );
    const roguishArchetype = getAnswerString(
      answers,
      "roguishArchetype",
      "Thief",
    );
    const arcaneTradition = getAnswerString(
      answers,
      "arcaneTradition",
      "Evocation",
    );
    const mainHand = getAnswerString(
      answers,
      "mainHand",
      getAnswerString(answers, "weapon", "Longsword"),
    );
    const offHand = getAnswerString(answers, "offHand", "None");
    const rangedWeapon = getAnswerString(answers, "rangedWeapon", "None");
    const armor = getAnswerString(answers, "armor", "No Armor");
    const shieldEquipped = getAnswerString(answers, "shieldEquipped", "No") === "Yes";
    const gearKit = getAnswerString(answers, "gearKit", "Explorer's Pack");
    const cantripOne = getAnswerString(answers, "cantripOne", "None");
    const cantripTwo = getAnswerString(answers, "cantripTwo", "None");
    const cantripThree = getAnswerString(answers, "cantripThree", "None");
    const spellLevel1A = getAnswerString(answers, "spellLevel1A", "None");
    const spellLevel1B = getAnswerString(answers, "spellLevel1B", "None");
    const spellLevel2A = getAnswerString(answers, "spellLevel2A", "None");
    const spellLevel2B = getAnswerString(answers, "spellLevel2B", "None");
    const spellLevel3A = getAnswerString(answers, "spellLevel3A", "None");
    const armorBase: Record<string, { base: number; dexCap: number | null }> = {
      "No Armor": { base: 10, dexCap: null },
      Leather: { base: 11, dexCap: null },
      "Studded Leather": { base: 12, dexCap: null },
      "Chain Shirt": { base: 13, dexCap: 2 },
      "Scale Mail": { base: 14, dexCap: 2 },
      Breastplate: { base: 14, dexCap: 2 },
      "Half Plate": { base: 15, dexCap: 2 },
      "Chain Mail": { base: 16, dexCap: 0 },
      Plate: { base: 18, dexCap: 0 },
    };
    const classHitDie: Record<string, number> = {
      Barbarian: 12,
      Bard: 8,
      Cleric: 8,
      Druid: 8,
      Fighter: 10,
      Monk: 8,
      Paladin: 10,
      Ranger: 10,
      Rogue: 8,
      Sorcerer: 6,
      Warlock: 8,
      Wizard: 6,
    };
    const ancestryTraits: Record<string, string[]> = {
      Aasimar: ["Darkvision", "Celestial Resistance", "Healing Hands"],
      Dragonborn: ["Draconic ancestry", "Breath Weapon", "Damage resistance"],
      Dwarf: ["Darkvision", "Dwarven Resilience", "Stonecunning"],
      Elf: ["Darkvision", "Fey Ancestry", "Trance"],
      Gnome: ["Darkvision", "Gnome Cunning"],
      Goliath: ["Powerful Build", "Stone's Endurance", "Mountain Born"],
      "Half-Elf": ["Darkvision", "Fey Ancestry", "Skill Versatility"],
      "Half-Orc": ["Darkvision", "Relentless Endurance", "Savage Attacks"],
      Halfling: ["Lucky", "Brave", "Halfling Nimbleness"],
      Human: ["Versatile", "Extra language"],
      Orc: ["Darkvision", "Aggressive", "Powerful Build"],
      Tiefling: ["Darkvision", "Hellish Resistance", "Infernal Legacy"],
    };
    const heritageTraits: Record<string, string[]> = {
      Standard: [],
      Highborn: ["Keen training", "Refined education"],
      Woodland: ["Fleet of foot", "Wilderness instincts"],
      Stout: ["Hardy build", "Poison-tested"],
      "Shadow-touched": ["Low-light stealth", "Occult presence"],
    };
    const classFeatures: Record<string, string[]> = {
      Barbarian: ["Rage", "Unarmored Defense"],
      Bard: ["Bardic Inspiration", "Spellcasting"],
      Cleric: ["Divine Domain", "Spellcasting"],
      Druid: ["Druidic", "Spellcasting"],
      Fighter: ["Second Wind"],
      Monk: ["Martial Arts", "Unarmored Defense"],
      Paladin: ["Divine Sense", "Lay on Hands"],
      Ranger: ["Favored Enemy", "Natural Explorer"],
      Rogue: ["Sneak Attack 1d6", "Expertise", "Thieves' Cant"],
      Sorcerer: ["Sorcerous Origin", "Spellcasting"],
      Warlock: ["Otherworldly Patron", "Pact Magic"],
      Wizard: ["Arcane Recovery", "Spellcasting"],
    };
    const spellcastingClasses = new Set([
      "Bard",
      "Cleric",
      "Druid",
      "Sorcerer",
      "Warlock",
      "Wizard",
    ]);
    const dexMod = Math.floor((stats.dex - 10) / 2);
    const conMod = Math.floor((stats.con - 10) / 2);
    const wisMod = Math.floor((stats.wis - 10) / 2);
    const armorProfile = armorBase[armor] ?? armorBase["No Armor"];
    const hp =
      (classHitDie[characterClass] ?? 8) +
      Math.max(1, conMod) +
      Math.max(0, level - 1) * (Math.floor((classHitDie[characterClass] ?? 8) / 2) + 1 + Math.max(1, conMod));
    const armorDexBonus =
      armorProfile.dexCap === null
        ? Math.max(0, dexMod)
        : Math.max(0, Math.min(dexMod, armorProfile.dexCap));
    let ac = armorProfile.base + armorDexBonus;
    if (characterClass === "Barbarian" && armor === "No Armor") {
      ac = 10 + Math.max(0, dexMod) + Math.max(0, conMod);
    }
    if (characterClass === "Monk" && armor === "No Armor") {
      ac = 10 + Math.max(0, dexMod) + Math.max(0, wisMod);
    }
    if (
      fightingStyle === "Defense" &&
      ["Fighter", "Paladin", "Ranger"].includes(characterClass) &&
      armor !== "No Armor"
    ) {
      ac += 1;
    }
    if (shieldEquipped) {
      ac += 2;
    }
    const knownCantrips = [cantripOne, cantripTwo, cantripThree].filter(
      (spell, index, values) =>
        spell !== "None" && values.indexOf(spell) === index,
    );
    const spellLevels = {
      level1: [spellLevel1A, spellLevel1B].filter(
        (spell, index, values) =>
          spell !== "None" && values.indexOf(spell) === index,
      ),
      level2: [spellLevel2A, spellLevel2B].filter(
        (spell, index, values) =>
          spell !== "None" && values.indexOf(spell) === index,
      ),
      level3: [spellLevel3A].filter(
        (spell, index, values) =>
          spell !== "None" && values.indexOf(spell) === index,
      ),
    };
    const flattenedLeveledSpells = [
      ...spellLevels.level1,
      ...spellLevels.level2,
      ...spellLevels.level3,
    ];
    const spellcastingAbility =
      characterClass === "Wizard"
        ? "Intelligence"
        : characterClass === "Cleric" || characterClass === "Druid"
          ? "Wisdom"
          : characterClass === "Bard" ||
              characterClass === "Paladin" ||
              characterClass === "Sorcerer" ||
              characterClass === "Warlock"
            ? "Charisma"
            : characterClass === "Ranger"
              ? "Wisdom"
              : "None";
    const combatFeatures = [...(classFeatures[characterClass] ?? [])];
    const subclassByClass: Partial<Record<string, string>> = {
      Barbarian: level >= 3 ? barbarianPath : "",
      Bard: level >= 3 ? bardCollege : "",
      Cleric: clericDomain,
      Druid: level >= 2 ? druidCircle : "",
      Fighter: level >= 3 ? fighterArchetype : "",
      Monk: level >= 3 ? monasticTradition : "",
      Paladin: level >= 3 ? paladinOath : "",
      Ranger: level >= 3 ? rangerConclave : "",
      Rogue: level >= 3 ? roguishArchetype : "",
      Sorcerer: sorcerousOrigin,
      Warlock: warlockPatron,
      Wizard: level >= 2 ? arcaneTradition : "",
    };
    if (characterClass === "Fighter") {
      combatFeatures.push(`Fighting Style: ${fightingStyle}`);
    }
    if (characterClass === "Paladin" || characterClass === "Ranger") {
      combatFeatures.push(`Fighting Style training: ${fightingStyle}`);
    }
    if (characterClass === "Rogue") {
      combatFeatures.push(`Expert focus: ${rogueTalent}`);
    }
    if (level >= 2 && characterClass === "Fighter") {
      combatFeatures.push("Action Surge");
    }
    if (level >= 2 && characterClass === "Rogue") {
      combatFeatures.push("Cunning Action");
    }
    if (level >= 5 && ["Fighter", "Paladin", "Ranger", "Barbarian", "Monk"].includes(characterClass)) {
      combatFeatures.push("Extra Attack");
    }
    if (subclassByClass[characterClass]) {
      combatFeatures.push(`Subclass: ${subclassByClass[characterClass]}`);
    }
    const darkvisionSources = new Set([
      "Aasimar",
      "Dwarf",
      "Elf",
      "Gnome",
      "Orc",
      "Goliath",
      "Half-Elf",
      "Half-Orc",
      "Tiefling",
    ]);
    const senses = darkvisionSources.has(ancestry)
      ? ["Darkvision 60 ft.", "Passive Perception 10"]
      : ["Normal vision", "Passive Perception 10"];
    const skillFocus =
      characterClass === "Rogue"
        ? [rogueTalent, "Perception", "Investigation"]
        : characterClass === "Fighter"
          ? ["Athletics", "Perception"]
          : characterClass === "Wizard"
            ? ["Arcana", "Investigation"]
            : characterClass === "Cleric"
              ? ["Insight", "Religion"]
              : characterClass === "Ranger"
                ? ["Survival", "Perception"]
                : ["Perception", "Insight"];
    const proficiencies = {
      armor,
      weapons:
        characterClass === "Wizard" || characterClass === "Sorcerer"
          ? "Simple weapons"
          : characterClass === "Rogue" || characterClass === "Bard"
            ? "Light weapons, hand crossbows, rapiers, shortswords"
            : "Simple and martial weapons",
      skills: skillFocus,
      tools:
        characterClass === "Rogue"
          ? ["Thieves' Tools"]
          : characterClass === "Bard"
            ? ["Musical instrument"]
            : [],
    };
    const equippedItems = [
      mainHand !== "None" ? mainHand : "",
      offHand !== "None" ? offHand : "",
      rangedWeapon !== "None" ? rangedWeapon : "",
      shieldEquipped ? "Shield" : "",
      armor !== "No Armor" ? armor : "",
    ].filter(Boolean);
    const equipment = [...equippedItems, gearKit];
    if (characterClass === "Rogue") {
      equipment.push("Thieves' Tools");
    }
    if (characterClass === "Cleric" || characterClass === "Paladin") {
      equipment.push("Holy Symbol");
    }
    const classResources =
      characterClass === "Fighter"
        ? { secondWind: "1/rest", actionSurge: level >= 2 ? "1/rest" : "locked" }
        : characterClass === "Rogue"
          ? { sneakAttack: `${Math.ceil(level / 2)}d6/turn` }
          : characterClass === "Barbarian"
            ? { rages: level >= 3 ? 3 : 2 }
            : characterClass === "Bard"
              ? { bardicInspiration: Math.max(3, Math.max(1, chaMod(stats))) }
              : characterClass === "Paladin"
                ? { layOnHands: level * 5 }
                : characterClass === "Warlock"
              ? { pactSlots: level >= 2 ? 2 : 1 }
                  : {};
    const weaponStatByName: Record<string, "str" | "dex"> = {
      Dagger: "dex",
      Rapier: "dex",
      Scimitar: "dex",
      Shortsword: "dex",
      Longbow: "dex",
      Shortbow: "dex",
      Crossbow: "dex",
      Sling: "dex",
    };
    const weaponDamageByName: Record<string, string> = {
      Battleaxe: "1d8 slashing",
      Crossbow: "1d8 piercing",
      Dagger: "1d4 piercing",
      Greataxe: "1d12 slashing",
      Greatsword: "2d6 slashing",
      Javelin: "1d6 piercing",
      Handaxe: "1d6 slashing",
      "Light Hammer": "1d4 bludgeoning",
      Longsword: "1d8 slashing",
      Longbow: "1d8 piercing",
      Mace: "1d6 bludgeoning",
      Maul: "2d6 bludgeoning",
      Quarterstaff: "1d6 bludgeoning",
      Rapier: "1d8 piercing",
      Scimitar: "1d6 slashing",
      Shortsword: "1d6 piercing",
      Shortbow: "1d6 piercing",
      Spear: "1d6 piercing",
      Sling: "1d4 bludgeoning",
    };
    const proficiencyBonus = level >= 9 ? 4 : level >= 5 ? 3 : 2;
    const resolveWeaponAttack = (weaponName: string) => {
      if (!weaponName || weaponName === "None") {
        return null;
      }

      const statKey = weaponStatByName[weaponName] ?? "str";
      const statValue = stats[statKey];
      const modifier = Math.floor((statValue - 10) / 2);
      const attackBonus = proficiencyBonus + modifier;
      const damageDice = weaponDamageByName[weaponName] ?? "1d6";
      const damageModText =
        modifier === 0
          ? ""
          : modifier > 0
            ? ` + ${modifier}`
            : ` - ${Math.abs(modifier)}`;

      return {
        weapon: weaponName,
        attackBonus,
        damage: `${damageDice}${damageModText}`,
        ability: statKey === "dex" ? "Dexterity" : "Strength",
      };
    };
    const spellcastingAbilityMod =
      spellcastingAbility === "Intelligence"
        ? Math.floor((stats.int - 10) / 2)
        : spellcastingAbility === "Wisdom"
          ? Math.floor((stats.wis - 10) / 2)
          : spellcastingAbility === "Charisma"
            ? Math.floor((stats.cha - 10) / 2)
            : 0;
    const spellAttackBonus =
      spellcastingAbility === "None"
        ? null
        : proficiencyBonus + spellcastingAbilityMod;
    const spellSaveDc =
      spellcastingAbility === "None"
        ? null
        : 8 + proficiencyBonus + spellcastingAbilityMod;
    const spellData = hasDndSpellcastingSlots(characterClass, level)
      ? {
          cantrips: spellcastingClasses.has(characterClass) ? knownCantrips : [],
          byLevel: {
            level1: spellLevels.level1,
            ...(getDndMaxSpellLevel(characterClass, level) >= 2
              ? { level2: spellLevels.level2 }
              : {}),
            ...(getDndMaxSpellLevel(characterClass, level) >= 3
              ? { level3: spellLevels.level3 }
              : {}),
          },
          ...(isDndPreparedCaster(characterClass)
            ? { preparedSpells: flattenedLeveledSpells }
            : { knownSpells: flattenedLeveledSpells }),
          ...(characterClass === "Wizard"
            ? {
                spellbook: [
                  ...new Set([
                    ...flattenedLeveledSpells,
                    ...spellLevels.level1,
                    ...(level >= 3 ? spellLevels.level2 : []),
                    ...(level >= 5 ? spellLevels.level3 : []),
                  ]),
                ],
              }
            : {}),
          signatureSpell:
            flattenedLeveledSpells[0] ??
            (spellcastingClasses.has(characterClass) ? knownCantrips[0] : undefined),
        }
      : null;

    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        class: characterClass,
        ancestry,
        heritage,
        level,
        hp: { current: hp, max: hp },
        ac,
        speed:
          ancestry === "Dwarf" || ancestry === "Halfling" || ancestry === "Gnome"
            ? 25
            : 30,
        proficiencyBonus,
        mainHand,
        offHand,
        rangedWeapon,
        shieldEquipped,
        armor,
        attackProfiles: {
          mainHand: resolveWeaponAttack(mainHand),
          offHand: resolveWeaponAttack(offHand),
          ranged: resolveWeaponAttack(rangedWeapon),
        },
        equipment,
        equippedItems,
        racialTraits: [
          ...(ancestryTraits[ancestry] ?? ["Adaptable heritage"]),
          ...(heritageTraits[heritage] ?? []),
        ],
        classFeatures: combatFeatures,
        subclass: subclassByClass[characterClass] || "None yet",
        proficiencies,
        senses,
        spellcastingAbility,
        spellAttackBonus,
        spellSaveDc,
        spells: spellData,
        resources: classResources,
        spellSlots:
          hasDndSpellcastingSlots(characterClass, level)
            ? buildDndSpellSlots(characterClass, level)
            : {},
        stats,
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a level ${level} ${ancestry.toLowerCase()} ${characterClass.toLowerCase()} shaped by ${backgroundText.toLowerCase()}. Key features include ${(combatFeatures[0] ?? "solid fundamentals").toLowerCase()}${combatFeatures[1] ? ` and ${combatFeatures[1].toLowerCase()}` : ""}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "deadlands classic") {
    const archetype = getAnswerString(answers, "archetype", "Gunslinger");
    const edgeOne = getAnswerString(
      answers,
      "edgeOne",
      getAnswerString(answers, "bestEdge", "Quick Draw"),
    );
    const edgeTwo = getAnswerString(answers, "edgeTwo", "None");
    const hindranceOne = getAnswerString(
      answers,
      "hindranceOne",
      getAnswerString(answers, "hindrance", "Wanted"),
    );
    const hindranceTwo = getAnswerString(answers, "hindranceTwo", "None");
    const selectedEdges = [edgeOne, edgeTwo].filter(
      (value, index, values) => value !== "None" && values.indexOf(value) === index,
    );
    const selectedHindrances = [hindranceOne, hindranceTwo].filter(
      (value, index, values) => value !== "None" && values.indexOf(value) === index,
    );
    const blessedMiracleOne = getAnswerString(answers, "blessedMiracleOne", "Smite");
    const blessedMiracleTwo = getAnswerString(answers, "blessedMiracleTwo", "None");
    const hucksterHexOne = getAnswerString(answers, "hucksterHexOne", "Soul Blast");
    const hucksterHexTwo = getAnswerString(answers, "hucksterHexTwo", "None");
    const shamanFavorOne = getAnswerString(answers, "shamanFavorOne", "Spirit Warrior");
    const shamanFavorTwo = getAnswerString(answers, "shamanFavorTwo", "None");
    const madScienceInventionOne = getAnswerString(
      answers,
      "madScienceInventionOne",
      "Electrostatic Projector",
    );
    const madScienceInventionTwo = getAnswerString(answers, "madScienceInventionTwo", "None");
    const arcanePool = getAnswerNumber(answers, "arcanePool", 3);
    const guts = getAnswerNumber(answers, "guts", 2);
    const deftness = getAnswerNumber(answers, "deftness", 3);
    const nimbleness = getAnswerNumber(answers, "nimbleness", 3);
    const quickness = getAnswerNumber(answers, "quickness", 3);
    const strength = getAnswerNumber(answers, "strength", 3);
    const vigor = getAnswerNumber(answers, "vigor", 3);
    const cognition = getAnswerNumber(answers, "cognition", 3);
    const knowledge = getAnswerNumber(answers, "knowledge", 3);
    const mien = getAnswerNumber(answers, "mien", 3);
    const smarts = getAnswerNumber(answers, "smarts", 3);
    const spirit = getAnswerNumber(answers, "spirit", 3);
    const primarySkill = getAnswerString(answers, "primarySkill", "Shootin'");
    const secondarySkill = getAnswerString(answers, "secondarySkill", "Guts");
    const mainHand = getAnswerString(answers, "mainHand", "Colt Peacemaker");
    const offHand = getAnswerString(answers, "offHand", "None");
    const longarm = getAnswerString(answers, "longarm", "None");
    const woundIgnore = getAnswerString(answers, "woundIgnore", "None");
    const woundHead = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundHead", 0)));
    const woundGuts = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundGuts", 0)));
    const woundLeftArm = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundLeftArm", 0)));
    const woundRightArm = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundRightArm", 0)));
    const woundLeftLeg = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundLeftLeg", 0)));
    const woundRightLeg = Math.max(0, Math.min(4, getAnswerNumber(answers, "woundRightLeg", 0)));
    const fateWhite = Math.max(0, Math.min(10, getAnswerNumber(answers, "fateWhite", 2)));
    const fateRed = Math.max(0, Math.min(10, getAnswerNumber(answers, "fateRed", 1)));
    const fateBlue = Math.max(0, Math.min(10, getAnswerNumber(answers, "fateBlue", 0)));
    const fateLegend = Math.max(0, Math.min(10, getAnswerNumber(answers, "fateLegend", 0)));
    const woundLocations = {
      head: woundHead,
      guts: woundGuts,
      leftArm: woundLeftArm,
      rightArm: woundRightArm,
      leftLeg: woundLeftLeg,
      rightLeg: woundRightLeg,
    };
    const fateChips = {
      white: fateWhite,
      red: fateRed,
      blue: fateBlue,
      legend: fateLegend,
    };
    const highestWound = Math.max(...Object.values(woundLocations));
    const totalWounds = Object.values(woundLocations).reduce(
      (total, value) => total + value,
      0,
    );
    const woundLevelByValue = ["Unharmed", "Light", "Heavy", "Serious", "Critical"] as const;
    const derivedWoundLevel = woundLevelByValue[highestWound] ?? "Critical";
    const ignoreReduction =
      woundIgnore === "Nerves o' Steel" || woundIgnore === "Veteran Resolve" ? 1 : 0;
    const derivedPenalty = Math.min(0, ignoreReduction - highestWound);
    const woundShorthand = `H${woundHead} G${woundGuts} LA${woundLeftArm} RA${woundRightArm} LL${woundLeftLeg} RL${woundRightLeg}`;
    const fateChipShorthand = `W${fateWhite} R${fateRed} B${fateBlue} L${fateLegend}`;
    const traitAverage =
      (deftness +
        nimbleness +
        quickness +
        strength +
        vigor +
        cognition +
        knowledge +
        mien +
        smarts +
        spirit) /
      10;
    const pace = Math.max(6, 6 + Math.floor((quickness - 3) / 2));
    const wind = 6 + vigor + guts + Math.max(0, Math.floor((traitAverage - 3) / 2));
    const baseSkills = [primarySkill, secondarySkill, "Guts", "Dodge"];
    const archetypeSkills: Record<string, string[]> = {
      Gunslinger: ["Shootin'", "Quick Draw", "Dodge"],
      Gambler: ["Gamblin'", "Persuasion", "Scrutinize"],
      Lawman: ["Overawe", "Shootin'", "Tracking"],
      Huckster: ["Hexslingin'", "Scrutinize", "Ridicule"],
      "Mad Scientist": ["Mad Science", "Knowledge (Academia)", "Shootin'"],
      Blessed: ["Faith", "Guts", "Persuasion"],
      Shaman: ["Faith", "Survival", "Tracking"],
      "Bounty Hunter": ["Tracking", "Shootin'", "Fightin'"],
      "Scout / Tracker": ["Tracking", "Survival", "Sneak"],
      "Soldier / Cavalry": ["Shootin'", "Horse Ridin'", "Fightin'"],
      Prospector: ["Survival", "Guts", "Scrutinize"],
      "Showman / Entertainer": ["Persuasion", "Ridicule", "Overawe"],
    };
    const selectedSkills = [
      ...new Set([...(archetypeSkills[archetype] ?? []), ...baseSkills]),
    ];
    const arcanePowers =
      archetype === "Blessed"
        ? [blessedMiracleOne, blessedMiracleTwo]
        : archetype === "Huckster"
          ? [hucksterHexOne, hucksterHexTwo]
          : archetype === "Shaman"
            ? [shamanFavorOne, shamanFavorTwo]
            : archetype === "Mad Scientist"
              ? [madScienceInventionOne, madScienceInventionTwo]
              : [];
    const selectedArcanePowers = arcanePowers.filter(
      (value, index, values) => value !== "None" && values.indexOf(value) === index,
    );
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        archetype,
        pace,
        wind,
        grit: guts,
        edgeOne,
        edgeTwo,
        hindranceOne,
        hindranceTwo,
        edges: selectedEdges,
        hinderances: selectedHindrances,
        arcanePool,
        blessedMiracleOne,
        blessedMiracleTwo,
        hucksterHexOne,
        hucksterHexTwo,
        shamanFavorOne,
        shamanFavorTwo,
        madScienceInventionOne,
        madScienceInventionTwo,
        traits: {
          deftness,
          nimbleness,
          quickness,
          strength,
          vigor,
          cognition,
          knowledge,
          mien,
          smarts,
          spirit,
        },
        primarySkill,
        secondarySkill,
        skills: selectedSkills,
        equipment: [
          mainHand,
          offHand !== "None" ? offHand : "",
          longarm !== "None" ? longarm : "",
          "Bedroll",
          "Canteen",
        ].filter(Boolean),
        mainHand,
        offHand,
        longarm,
        woundsByLocation: woundLocations,
        woundShorthand,
        fateChips,
        fateChipShorthand,
        wounds: {
          current: highestWound,
          max: 4,
          threshold: 4,
          level: derivedWoundLevel,
          penalty: derivedPenalty,
          total: totalWounds,
          ignoreSource: woundIgnore,
        },
        arcane:
          selectedArcanePowers.length > 0
            ? {
                background: archetype,
                castingSkill:
                  archetype === "Blessed" || archetype === "Shaman"
                    ? "Faith"
                    : archetype === "Huckster"
                      ? "Hexslingin'"
                      : archetype === "Mad Scientist"
                        ? "Mad Science"
                        : "None",
                points: arcanePool,
                powers: selectedArcanePowers,
              }
            : null,
        woundLevels: [
          { level: "Unharmed", value: 0, penalty: 0 },
          { level: "Light", value: 1, penalty: -1 },
          { level: "Heavy", value: 2, penalty: -2 },
          { level: "Serious", value: 3, penalty: -3 },
          { level: "Critical", value: 4, penalty: -4 },
        ],
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${archetype.toLowerCase()} with ${(selectedEdges[0] ?? edgeOne).toLowerCase()}, burdened by ${(selectedHindrances[0] ?? hindranceOne).toLowerCase()}, and trouble close behind: ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "savage rifts") {
    const framework = getAnswerString(answers, "framework", "M.A.R.S.");
    const combatRole = getAnswerString(answers, "combatRole", "frontline");
    const bennies = getAnswerNumber(answers, "bennies", 3);
    const toughnessBase =
      framework === "Glitter Boy" ? 14 : framework === "Cyber-Knight" ? 11 : 8;
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        framework,
        pace: combatRole === "mobile" ? 8 : 6,
        parry: combatRole === "frontline" ? 7 : 5,
        toughness: toughnessBase + (combatRole === "frontline" ? 1 : 0),
        bennies,
        combatRole,
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${framework.toLowerCase()} serving as a ${combatRole} operator, hardened by ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "mutants in the now") {
    const species = getAnswerString(answers, "species", "Mutant alley cat");
    const streetRole = getAnswerString(answers, "streetRole", "Scout");
    const ferocity = getAnswerNumber(answers, "ferocity", 3);
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        species,
        role: streetRole,
        hp: 8 + ferocity,
        ferocity,
        instincts:
          streetRole === "Tinkerer"
            ? ["jury-rigging", "salvage sense"]
            : streetRole === "Face"
              ? ["fast talk", "street read"]
              : streetRole === "Bruiser"
                ? ["shell shock", "body check"]
                : ["parkour", "ambush sense"],
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${species.toLowerCase()} ${streetRole.toLowerCase()} with a history in ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "astonishing super heroes") {
    const origin = getAnswerString(answers, "origin", "Mutant");
    const powerProfile = getAnswerString(answers, "powerProfile", "force");
    const control = getAnswerNumber(answers, "control", 3);
    const powerSet =
      powerProfile === "mobility"
        ? ["flight", "evasive burst"]
        : powerProfile === "control"
          ? ["binding field", "countermeasure pulse"]
          : ["force blast", "kinetic barrier"];
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        origin,
        powerSet,
        health: 14 + control,
        defense: 11 + control,
        control,
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${origin.toLowerCase()} hero wielding ${powerProfile} powers while carrying ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "star wars rpg") {
    const archetype = getAnswerString(answers, "archetype", "Smuggler");
    const specialty = getAnswerString(answers, "specialty", "Piloting");
    const forceAffinity = getAnswerNumber(answers, "forceAffinity", 1);
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        archetype,
        strain: 10 + forceAffinity,
        wounds: { current: 0, threshold: 11 + (archetype === "Soldier" ? 3 : 1) },
        forceAffinity,
        skills: [specialty, "Streetwise", archetype === "Mystic" ? "Discipline" : "Vigilance"],
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${archetype.toLowerCase()} with ${specialty.toLowerCase()} at the core of their survival, driven by ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "legend of 5 rings 4e") {
    const clan = getAnswerString(answers, "clan", "Ronin");
    const school = getAnswerString(answers, "school", "Bushi");
    const ringFocus = getAnswerString(answers, "ringFocus", "fire");
    const rings = {
      air: 2,
      earth: 2,
      fire: 2,
      water: 2,
      void: 2,
    };
    rings[ringFocus as keyof typeof rings] = 3;
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        clan,
        school,
        honor: school === "Courtier" ? 6.5 : 5,
        status: clan === "Ronin" ? 0.5 : 1,
        rings,
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} serves as a ${clan.toLowerCase()} ${school.toLowerCase()}, pulled between duty and ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "vampire: the masqureade v5") {
    const clan = getAnswerString(answers, "clan", "Brujah");
    const predatorType = getAnswerString(answers, "predatorType", "Alleycat");
    const humanity = getAnswerNumber(answers, "humanity", 6);
    const hunger = predatorType === "Alleycat" ? 2 : 1;
    return finalizeGeneratedCharacter({
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        clan,
        predatorType,
        hunger,
        humanity,
        disciplines:
          clan === "Nosferatu"
            ? ["obfuscate", "animalism"]
            : clan === "Toreador"
              ? ["auspex", "celerity"]
              : clan === "Ventrue"
                ? ["dominate", "fortitude"]
                : ["celerity", "potence"],
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName} is a ${clan.toLowerCase()} ${predatorType.toLowerCase()} clinging to ${backgroundText.toLowerCase()}.`,
        personalityText,
      ),
    });
  }

  if (normalizedRuleset === "call of cthulhu") {
    const occupation = getAnswerString(answers, "occupation", "Antiquarian");
    const bestSkill = getAnswerString(answers, "bestSkill", "Library Use");
    const nerve = getAnswerNumber(answers, "nerve", 3);
    return {
      name: cleanName,
      role: "player",
      isMainCharacter: true,
      sheetJson: {
        source: "user-generated",
        background: backgroundText,
        physicalDescription: physicalDescriptionText,
        ...(portraitDataUrl ? { portraitDataUrl } : {}),
          personality: personalityText,
          age,
          gender,
        occupation,
        hp: 8 + nerve,
        sanity: 45 + nerve * 3,
        luck: 40 + nerve * 4,
        bestSkill,
      },
      memorySummary: appendPersonalitySummary(
        `${cleanName}, a ${occupation.toLowerCase()}, keeps chasing ${backgroundText.toLowerCase()} despite mounting dread.`,
        personalityText,
      ),
    };
  }

  const role = getAnswerString(answers, "role", "Adventurer");
  const competence = getAnswerNumber(answers, "competence", 3);
  const startingEquipment = getAnswerString(
    answers,
    "startingEquipment",
    "Travel gear",
  );
  const startingSpell = getAnswerString(answers, "startingSpell", "None");
  return finalizeGeneratedCharacter({
    name: cleanName,
    role: "player",
    isMainCharacter: true,
    sheetJson: {
      source: "user-generated",
      background: backgroundText,
      physicalDescription: physicalDescriptionText,
      ...(portraitDataUrl ? { portraitDataUrl } : {}),
        personality: personalityText,
        age,
        gender,
      role,
      competence,
      startingEquipment,
      spells: startingSpell === "None" ? [] : [startingSpell],
      notes: `Starter sheet for ${ruleset}.`,
    },
    memorySummary: appendPersonalitySummary(
      `${cleanName} is a ${role.toLowerCase()} with solid fundamentals and a past shaped by ${backgroundText.toLowerCase()}.`,
      personalityText,
    ),
  });
}
