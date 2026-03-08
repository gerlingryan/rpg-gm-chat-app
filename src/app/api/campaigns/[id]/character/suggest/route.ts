import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import {
  getVisibleCharacterQuestions,
  type CharacterQuestion,
} from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

function inferDeadlandsArchetype(
  concept: string,
  fallback = "Gunslinger",
) {
  const normalizedConcept = concept.toLowerCase();

  if (/\bpreacher|priest|faith|holy|blessed\b/.test(normalizedConcept)) return "Blessed";
  if (/\bhuckster|hex|card sharp|gambl|gamblin\b/.test(normalizedConcept)) return "Huckster";
  if (/\btribal|spirit talk|medicine man|shaman\b/.test(normalizedConcept)) return "Shaman";
  if (/\binventor|gizmo|mad science|scientist|contraption\b/.test(normalizedConcept)) return "Mad Scientist";
  if (/\blaw|marshal|deputy|sheriff|lawman\b/.test(normalizedConcept)) return "Lawman";
  if (/\bbounty hunter|tracker|hunt\b/.test(normalizedConcept)) return "Bounty Hunter";
  if (/\bscout|trail|woodsman|ranger\b/.test(normalizedConcept)) return "Scout / Tracker";
  if (/\bsoldier|cavalry|trooper|veteran\b/.test(normalizedConcept)) return "Soldier / Cavalry";
  if (/\bprospector|miner|claim\b/.test(normalizedConcept)) return "Prospector";
  if (/\bshowman|performer|entertainer|actor|singer\b/.test(normalizedConcept)) return "Showman / Entertainer";
  if (/\bgambler|card\b/.test(normalizedConcept)) return "Gambler";
  if (/\bgunslinger|quick draw|duelist|gunfighter\b/.test(normalizedConcept)) return "Gunslinger";

  return fallback;
}

function getQuestionFallback(
  question: CharacterQuestion,
  currentAnswers: Record<string, string | number | null | undefined>,
) {
  const currentValue = currentAnswers[question.id];

  if (typeof currentValue === "string" || typeof currentValue === "number") {
    return currentValue;
  }

  if (typeof question.defaultValue === "string" || typeof question.defaultValue === "number") {
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
) {
  const sanitizedAnswers: Record<string, string | number> = {
    ...Object.fromEntries(
      Object.entries(currentAnswers).filter(
        ([, value]) => typeof value === "string" || typeof value === "number",
      ),
    ),
  };

  for (const question of questions) {
    const suggestedValue = rawAnswers?.[question.id];

    if (question.kind === "select") {
      const validValues = question.options?.map((option) => option.value) ?? [];
      const nextValue =
        typeof suggestedValue === "string" && validValues.includes(suggestedValue)
          ? suggestedValue
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
      typeof suggestedValue === "string" && suggestedValue.trim()
        ? suggestedValue.trim().slice(0, 280)
        : String(getQuestionFallback(question, currentAnswers));
  }

  return sanitizedAnswers;
}

function buildHeuristicSuggestions(
  concept: string,
  questions: CharacterQuestion[],
) {
  const normalizedConcept = concept.toLowerCase();
  const heuristicAnswers: Record<string, unknown> = {};
  const isDeadlandsQuestionnaire = questions.some((question) => question.id === "deftness");
  const inferredDeadlandsArchetype = inferDeadlandsArchetype(concept, "Gunslinger");

  for (const question of questions) {
    if (question.kind === "select" && question.options) {
      const matchedOption = question.options.find((option) =>
        normalizedConcept.includes(option.value.toLowerCase()),
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
                : inferredDeadlandsArchetype === "Lawman"
                  ? "Keen"
                  : "Hard to Kill";
          continue;
        }

        if (question.id === "edgeTwo") {
          heuristicAnswers[question.id] =
            inferredDeadlandsArchetype === "Gunslinger" ? "Level Headed" : "None";
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

        if (question.id === "hindranceTwo") {
          heuristicAnswers[question.id] = "None";
          continue;
        }

        if (question.id === "primarySkill") {
          heuristicAnswers[question.id] =
            inferredDeadlandsArchetype === "Blessed"
              ? "Faith"
              : inferredDeadlandsArchetype === "Huckster"
                ? "Hexslingin'"
                : inferredDeadlandsArchetype === "Mad Scientist"
                  ? "Mad Science"
                  : inferredDeadlandsArchetype === "Scout / Tracker"
                    ? "Tracking"
                    : "Shootin'";
          continue;
        }

        if (question.id === "secondarySkill") {
          heuristicAnswers[question.id] =
            inferredDeadlandsArchetype === "Blessed"
              ? "Guts"
              : inferredDeadlandsArchetype === "Huckster"
                ? "Scrutinize"
                : inferredDeadlandsArchetype === "Mad Scientist"
                  ? "Knowledge"
                  : "Dodge";
          continue;
        }

        if (question.id === "mainHand") {
          heuristicAnswers[question.id] =
            inferredDeadlandsArchetype === "Gunslinger" || inferredDeadlandsArchetype === "Lawman"
              ? "Colt Peacemaker"
              : inferredDeadlandsArchetype === "Scout / Tracker"
                ? "Bow Knife"
                : "Schofield Revolver";
          continue;
        }

        if (question.id === "offHand") {
          heuristicAnswers[question.id] = /\bdual|two[- ]?gun|two[- ]?weapon\b/.test(
            normalizedConcept,
          )
            ? "Derringer"
            : "None";
          continue;
        }

        if (question.id === "longarm") {
          heuristicAnswers[question.id] =
            inferredDeadlandsArchetype === "Soldier / Cavalry" ||
            inferredDeadlandsArchetype === "Bounty Hunter"
              ? "Winchester Rifle"
              : inferredDeadlandsArchetype === "Scout / Tracker"
                ? "Hunting Rifle"
                : "None";
          continue;
        }

        if (question.id === "blessedMiracleOne" && inferredDeadlandsArchetype === "Blessed") {
          heuristicAnswers[question.id] = "Smite";
          continue;
        }

        if (question.id === "hucksterHexOne" && inferredDeadlandsArchetype === "Huckster") {
          heuristicAnswers[question.id] = "Soul Blast";
          continue;
        }

        if (question.id === "shamanFavorOne" && inferredDeadlandsArchetype === "Shaman") {
          heuristicAnswers[question.id] = "Spirit Warrior";
          continue;
        }

        if (
          question.id === "madScienceInventionOne" &&
          inferredDeadlandsArchetype === "Mad Scientist"
        ) {
          heuristicAnswers[question.id] = "Electrostatic Projector";
          continue;
        }
      }

      if (question.id === "mainHand") {
        if (
          /\b(two[- ]handed|greatsword|big sword|large sword|huge sword)\b/.test(
            normalizedConcept,
          )
        ) {
          heuristicAnswers[question.id] = "Greatsword";
          continue;
        }

        if (/\bbow|archer|ranged\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Longsword";
          continue;
        }
      }

      if (question.id === "offHand") {
        if (
          /\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(
            normalizedConcept,
          )
        ) {
          heuristicAnswers[question.id] = "Shortsword";
          continue;
        }

        heuristicAnswers[question.id] = "None";
        continue;
      }

      if (question.id === "rangedWeapon" && /\bbow|archer|ranged\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = "Longbow";
        continue;
      }

      if (question.id === "shieldEquipped") {
        if (
          /\b(two|dual|twin)[- ]?(weapon|wield|wields|sword|swords|blade|blades)\b|\btwo long swords\b|\bdual wield\b/.test(
            normalizedConcept,
          )
        ) {
          heuristicAnswers[question.id] = "No";
          continue;
        }

        if (/\btank|shield|defen[cs]e|protector\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Yes";
          continue;
        }
      }

      if (question.id === "armor") {
        if (/\bheavy armor|plate|mail\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Chain Mail";
          continue;
        }

        if (/\blight armor|leather|stealthy\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Leather";
          continue;
        }
      }
    }

    if (question.kind === "number") {
      if (
        [
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
        ].includes(question.id)
      ) {
        const skillLean = /\bquick|agile|quiet|fast\b/.test(normalizedConcept)
          ? ["nimbleness", "quickness"]
          : /\bstrong|tough|brawler\b/.test(normalizedConcept)
            ? ["strength", "vigor"]
            : /\bsmart|cunning|book|scientist\b/.test(normalizedConcept)
              ? ["knowledge", "smarts"]
              : /\bwatchful|tracker|scout\b/.test(normalizedConcept)
                ? ["cognition", "knowledge"]
                : [];

        heuristicAnswers[question.id] = Math.min(
          question.max ?? 5,
          Math.max(
            question.min ?? 1,
            skillLean.includes(question.id) ? 4 : 3,
          ),
        );
        continue;
      }

      if (question.id === "guts") {
        heuristicAnswers[question.id] = /\bgrim|fearless|hardened|veteran\b/.test(normalizedConcept)
          ? Math.min(question.max ?? 5, 4)
          : Math.min(question.max ?? 5, 3);
        continue;
      }

      if (question.id === "arcanePool") {
        heuristicAnswers[question.id] = /\bpowerful|gifted|veteran\b/.test(normalizedConcept)
          ? Math.min(question.max ?? 10, 4)
          : Math.min(question.max ?? 10, 3);
        continue;
      }

      if (
        [
          "woundHead",
          "woundGuts",
          "woundLeftArm",
          "woundRightArm",
          "woundLeftLeg",
          "woundRightLeg",
        ].includes(question.id)
      ) {
        const defaultWound =
          question.id === "woundGuts" && /\bwounded|injured|hurt|gut shot\b/.test(normalizedConcept)
            ? 1
            : 0;
        heuristicAnswers[question.id] = 0;
        if (defaultWound > 0) {
          heuristicAnswers[question.id] = defaultWound;
        }
        continue;
      }

      if (["fateWhite", "fateRed", "fateBlue", "fateLegend"].includes(question.id)) {
        if (question.id === "fateWhite") {
          heuristicAnswers[question.id] = 2;
        } else if (question.id === "fateRed") {
          heuristicAnswers[question.id] = 1;
        } else {
          heuristicAnswers[question.id] = 0;
        }
        continue;
      }

      if (question.id === "str" && /\bstrong|powerful|muscular|brute\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 16);
        continue;
      }

      if (
        question.id === "int" &&
        /\bstupid|dumb|slow|not smart|dim\b/.test(normalizedConcept)
      ) {
        heuristicAnswers[question.id] = Math.max(question.min ?? 8, 8);
        continue;
      }

      if (question.id === "dex" && /\bagile|quick|nimble\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 15);
        continue;
      }

      if (question.id === "con" && /\btough|hardy|durable\b/.test(normalizedConcept)) {
        heuristicAnswers[question.id] = Math.min(question.max ?? 18, 15);
        continue;
      }
    }

    if (question.kind === "textarea") {
      if (question.id === "background") {
        heuristicAnswers[question.id] = `Drawn from the concept: ${concept.trim()}`.slice(
          0,
          280,
        );
        continue;
      }

      if (question.id === "physicalDescription") {
        heuristicAnswers[question.id] = concept.trim().slice(0, 280);
        continue;
      }

      if (question.id === "personality") {
        const personalityNotes: string[] = [];

        if (/\bhates\b/.test(normalizedConcept)) {
          const targetMatch = concept.match(/\bhates?\s+([a-zA-Z' -]+)/i);
          personalityNotes.push(
            targetMatch?.[0]?.trim() ?? "Carries a strong prejudice",
          );
        }
        if (/\bstrong|powerful|muscular|brute\b/.test(normalizedConcept)) {
          personalityNotes.push("leans on strength first");
        }
        if (/\bstupid|dumb|slow|not smart|dim\b/.test(normalizedConcept)) {
          personalityNotes.push("poor with planning and book learning");
        }

        heuristicAnswers[question.id] =
          (personalityNotes.join("; ") || concept.trim()).slice(0, 280);
      }
    }
  }

  return heuristicAnswers;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const concept = typeof body.concept === "string" ? body.concept.trim() : "";
  const currentAnswers =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? (body.answers as Record<string, string | number | null | undefined>)
      : {};

  if (!concept) {
    return NextResponse.json({ error: "concept is required" }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const visibleQuestions = getVisibleCharacterQuestions(campaign.ruleset, currentAnswers);
  const promptQuestionSummary = visibleQuestions
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

  const heuristicAnswers = buildHeuristicSuggestions(concept, visibleQuestions);
  let rawAnswers: Record<string, unknown> | null = null;

  try {
    const response = await openai.responses.create({
      model: "gpt-5.1-mini",
      input: [
        {
          role: "system",
          content: [
            "You help draft tabletop RPG character creation fields.",
            "Based on the user's concept and the listed visible fields, produce a single JSON object.",
            "Only include keys that match the listed field ids.",
            "For select fields, you must choose exactly one allowed option value.",
            "For number fields, return an integer inside the allowed range.",
            "For textarea fields, return concise flavorful text that fits the concept.",
            "Do not include explanation, markdown, or extra text outside the JSON object.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Ruleset: ${campaign.ruleset}`,
            "",
            "Character concept:",
            concept,
            "",
            "Current answers:",
            JSON.stringify(currentAnswers, null, 2),
            "",
            "Visible fields:",
            promptQuestionSummary,
          ].join("\n"),
        },
      ],
    });

    rawAnswers = {
      ...heuristicAnswers,
      ...(parseJsonObject(response.output_text ?? "") ?? {}),
    };
  } catch {
    rawAnswers = heuristicAnswers;
  }

  const suggestedAnswers = sanitizeSuggestedAnswers(
    visibleQuestions,
    rawAnswers,
    currentAnswers,
  );

  return NextResponse.json({
    answers: suggestedAnswers,
  });
}
