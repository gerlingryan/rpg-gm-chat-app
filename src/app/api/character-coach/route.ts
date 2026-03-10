import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import {
  clampText,
  extractRequestedFields,
  extractRequestedOptionCount,
  formatCoachReplyWithSections,
  parseJsonObject,
} from "@/lib/character-coach";

type CoachMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};

  const ruleset =
    typeof body.ruleset === "string" && body.ruleset.trim()
      ? body.ruleset.trim()
      : "D&D 5e";
  const userMessage =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : "";
  const transcript = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
        .map((entry) => ({
          role:
            entry.role === "assistant" || entry.role === "user"
              ? (entry.role as "assistant" | "user")
              : "user",
          content: typeof entry.content === "string" ? entry.content.trim() : "",
        }))
        .filter((entry) => entry.content.length > 0)
        .slice(-8)
    : [];
  const snapshot =
    body.snapshot && typeof body.snapshot === "object" && !Array.isArray(body.snapshot)
      ? (body.snapshot as Record<string, unknown>)
      : {};
  const explicitTargetField =
    body.targetField === "personality" ||
    body.targetField === "background" ||
    body.targetField === "physicalDescription"
      ? body.targetField
      : "auto";

  if (!userMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const requestedOptionCount = extractRequestedOptionCount(userMessage);
  const requestedFields = extractRequestedFields(userMessage);
  if (explicitTargetField !== "auto") {
    requestedFields.clear();
    requestedFields.add(explicitTargetField);
  }
  const requestedFieldsList = [...requestedFields];
  const targetedFieldGuardrail =
    requestedFieldsList.length > 0
      ? [
          `The user requested only these fields: ${requestedFieldsList.join(", ")}.`,
          "Populate only those fields and matching option arrays.",
          "For non-requested fields, return empty strings and empty arrays.",
        ].join(" ")
      : "If user intent is broad, you may populate any relevant fields.";

  const transcriptText =
    transcript.length > 0
      ? transcript
          .map((entry) => `${entry.role === "assistant" ? "Coach" : "User"}: ${entry.content}`)
          .join("\n")
      : "No prior coach messages.";
  const snapshotText = JSON.stringify(
    {
      characterName:
        typeof snapshot.characterName === "string" ? snapshot.characterName : "",
      fields: snapshot.fields && typeof snapshot.fields === "object" ? snapshot.fields : {},
    },
    null,
    2,
  );

  try {
    let retryUsed = false;
    const runCoachRequest = async (strictMode: boolean) => {
      const response = await openai.responses.create({
        model: "gpt-5.1",
        input: [
          {
            role: "system",
            content: [
              "You are a character creation coach for tabletop RPG players.",
              "You provide advice only. You do not claim to save or change character data.",
              `Ruleset context: ${ruleset}.`,
              "Respond with valid JSON only in this exact shape:",
              '{"reply":"<short coaching response>","suggestions":{"personality":"<optional text>","background":"<optional text>","physicalDescription":"<optional text>"},"options":{"personalityOptions":["<option 1>"],"backgroundOptions":["<option 1>"],"physicalDescriptionOptions":["<option 1>"]}}',
              "Keep reply under 140 words.",
              "Suggestion fields are optional, but include them when user asks for writing help.",
              "If user asks for multiple options, provide them in the matching options array with complete text (no placeholders).",
              targetedFieldGuardrail,
              strictMode
                ? "Be concrete and complete. Do not return generic intros without the requested options/content."
                : "",
              "Do not include markdown, code fences, or extra keys.",
            ]
              .filter(Boolean)
              .join(" "),
          },
          {
            role: "user",
            content: [
              "Current form snapshot:",
              snapshotText,
              "",
              "Recent chat transcript:",
              transcriptText,
              "",
              `Requested option count hint: ${requestedOptionCount ?? 1}`,
              "",
              `New user request: ${userMessage}`,
            ].join("\n"),
          },
        ],
      });
      return (
        parseJsonObject(response.output_text ?? "") ??
        ({
          reply:
            "I can help shape personality, background, or physical description. Tell me the tone you want.",
          suggestions: {},
        } as Record<string, unknown>)
      );
    };

    let parsed = await runCoachRequest(false);

    const suggestionsSource =
      parsed.suggestions && typeof parsed.suggestions === "object" && !Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as Record<string, unknown>)
        : {};
    const optionsSource =
      parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
        ? (parsed.options as Record<string, unknown>)
        : {};
    const readOptions = (value: unknown, maxLength: number) =>
      Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => clampText(entry, maxLength))
            .filter((entry) => entry.length > 0)
            .slice(0, Math.max(1, requestedOptionCount ?? 3))
        : [];

    const firstPassReply = clampText(parsed.reply, 1200);
    const firstPassOptionsCount =
      readOptions(optionsSource.personalityOptions, 1000).length +
      readOptions(optionsSource.backgroundOptions, 1800).length +
      readOptions(optionsSource.physicalDescriptionOptions, 700).length;
    const firstPassSuggestionsCount = [
      clampText(suggestionsSource.personality, 1000),
      clampText(suggestionsSource.background, 1800),
      clampText(suggestionsSource.physicalDescription, 700),
    ].filter((value) => value.length > 0).length;
    const looksGeneric =
      firstPassReply.length < 55 ||
      /(here are|i can help|tell me the tone|adapt to your|build on)/i.test(firstPassReply);
    const expectedOptions = requestedOptionCount !== null || /\boptions?\b/i.test(userMessage);
    const shouldRetryForQuality =
      looksGeneric &&
      ((expectedOptions && firstPassOptionsCount === 0) ||
        (!expectedOptions && firstPassSuggestionsCount === 0));

    if (shouldRetryForQuality) {
      parsed = await runCoachRequest(true);
      retryUsed = true;
    }

    const finalSuggestionsSource =
      parsed.suggestions && typeof parsed.suggestions === "object" && !Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as Record<string, unknown>)
        : {};
    const finalOptionsSource =
      parsed.options && typeof parsed.options === "object" && !Array.isArray(parsed.options)
        ? (parsed.options as Record<string, unknown>)
        : {};

    const personalityOptions =
      requestedFields.size === 0 || requestedFields.has("personality")
        ? readOptions(finalOptionsSource.personalityOptions, 1000)
        : [];
    const backgroundOptions =
      requestedFields.size === 0 || requestedFields.has("background")
        ? readOptions(finalOptionsSource.backgroundOptions, 1800)
        : [];
    const physicalDescriptionOptions =
      requestedFields.size === 0 || requestedFields.has("physicalDescription")
        ? readOptions(finalOptionsSource.physicalDescriptionOptions, 700)
        : [];
    const baseReply =
      clampText(parsed.reply, 1200) ||
      "I can help shape personality, background, or physical description. Tell me the tone you want.";
    const coachMessage: CoachMessage = {
      role: "assistant",
      content: formatCoachReplyWithSections({
        reply: baseReply,
        personalityCount: personalityOptions.length,
        backgroundCount: backgroundOptions.length,
        physicalCount: physicalDescriptionOptions.length,
      }),
    };
    console.info("[character-coach]", {
      targetField: explicitTargetField,
      requestedFields: requestedFieldsList,
      requestedOptionCount: requestedOptionCount ?? null,
      retryUsed,
      optionCounts: {
        personality: personalityOptions.length,
        background: backgroundOptions.length,
        physical: physicalDescriptionOptions.length,
      },
    });

    return NextResponse.json({
      message: coachMessage,
      suggestions: {
        personality:
          requestedFields.size === 0 || requestedFields.has("personality")
            ? clampText(finalSuggestionsSource.personality, 1000)
            : "",
        background:
          requestedFields.size === 0 || requestedFields.has("background")
            ? clampText(finalSuggestionsSource.background, 1800)
            : "",
        physicalDescription:
          requestedFields.size === 0 || requestedFields.has("physicalDescription")
            ? clampText(finalSuggestionsSource.physicalDescription, 700)
            : "",
      },
      options: {
        personalityOptions,
        backgroundOptions,
        physicalDescriptionOptions,
      },
      meta: {
        retryUsed,
        targetField: explicitTargetField,
      },
    });
  } catch {
    return NextResponse.json(
      {
        message: {
          role: "assistant",
          content:
            "I couldn't generate coaching suggestions right now. Try asking for one field at a time (personality, background, or physical description).",
        } satisfies CoachMessage,
        suggestions: {},
        options: {
          personalityOptions: [],
          backgroundOptions: [],
          physicalDescriptionOptions: [],
        },
      },
      { status: 200 },
    );
  }
}
