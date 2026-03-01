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

  for (const question of questions) {
    if (question.kind === "select" && question.options) {
      const matchedOption = question.options.find((option) =>
        normalizedConcept.includes(option.value.toLowerCase()),
      );

      if (matchedOption) {
        heuristicAnswers[question.id] = matchedOption.value;
        continue;
      }

      if (question.id === "weapon") {
        if (
          /\b(two[- ]handed|greatsword|big sword|large sword|huge sword)\b/.test(
            normalizedConcept,
          )
        ) {
          heuristicAnswers[question.id] = "Greataxe";
          continue;
        }

        if (/\bbow|archer|ranged\b/.test(normalizedConcept)) {
          heuristicAnswers[question.id] = "Longbow";
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
