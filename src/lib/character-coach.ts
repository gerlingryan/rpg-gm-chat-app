export type CoachFieldId = "name" | "personality" | "background" | "physicalDescription";

export function shouldGenerateFieldSuggestions(params: {
  message: string;
  explicitTargetField: "auto" | CoachFieldId;
  requestedFields: Set<CoachFieldId>;
  requestedOptionCount: number | null;
}) {
  if (params.explicitTargetField !== "auto") {
    return true;
  }
  if (params.requestedFields.size > 0) {
    return true;
  }
  if (params.requestedOptionCount !== null) {
    return true;
  }

  // If the user asks for writing/creation help without naming a specific field,
  // still allow suggestions/options. Otherwise keep responses advisory-only.
  return /\b(idea|ideas|option|options|suggest|suggestion|draft|rewrite|reword|variant|generate|create)\b/i.test(
    params.message,
  );
}

export function extractRequestedOptionCount(message: string) {
  const toClampedCount = (raw: string | undefined) => {
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10, Math.trunc(parsed)));
    }
    return null;
  };

  // Examples:
  // - "give me 3 options"
  // - "give me 7 more names"
  // - "need 5 background ideas"
  const explicitNumber = message.match(
    /\b(\d{1,2})\s+(?:more\s+)?(?:personality\s+)?(?:name|names|options?|ideas?|backgrounds?|backstories|physical(?:\s+description)?s?)\b/i,
  );
  const explicitCount = toClampedCount(explicitNumber?.[1]);
  if (explicitCount !== null) {
    return explicitCount;
  }

  // Fallback: any explicit leading count phrase still hints desired quantity.
  const genericCount = toClampedCount(message.match(/\b(\d{1,2})\b/)?.[1]);
  if (genericCount !== null && /\b(more|another|additional|extra|new)\b/i.test(message)) {
    return genericCount;
  }

  if (/\bseveral\b/i.test(message) || /\bfew\b/i.test(message)) {
    return 3;
  }
  return null;
}

export function extractRequestedFields(message: string) {
  const lower = message.toLowerCase();
  const requested = new Set<CoachFieldId>();

  if (/\bname\b|\bnames\b|\brename\b|\bnaming\b/.test(lower)) {
    requested.add("name");
  }
  if (/\bpersonality\b|\bvoice\b|\bdemeanor\b|\btemperament\b/.test(lower)) {
    requested.add("personality");
  }
  if (/\bbackground\b|\bbackstory\b|\borigin\b|\bpast\b/.test(lower)) {
    requested.add("background");
  }
  if (/\bphysical\b|\bappearance\b|\blooks?\b|\bdescription\b/.test(lower)) {
    requested.add("physicalDescription");
  }

  return requested;
}

export function parseJsonObject(text: string) {
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

export function clampText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

export function formatCoachReplyWithSections(params: {
  reply: string;
  nameCount: number;
  personalityCount: number;
  backgroundCount: number;
  physicalCount: number;
}) {
  const headers: string[] = [];
  if (params.nameCount > 0) {
    headers.push("Name");
  }
  if (params.personalityCount > 0) {
    headers.push("Personality");
  }
  if (params.backgroundCount > 0) {
    headers.push("Background");
  }
  if (params.physicalCount > 0) {
    headers.push("Physical");
  }
  if (headers.length === 0) {
    return params.reply;
  }
  return `${params.reply}\n\nSections: ${headers.join(" | ")} options`;
}

export function normalizeCoachApiResponse(raw: unknown) {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const messageSource =
    body.message && typeof body.message === "object" && !Array.isArray(body.message)
      ? (body.message as Record<string, unknown>)
      : {};
  const suggestionsSource =
    body.suggestions && typeof body.suggestions === "object" && !Array.isArray(body.suggestions)
      ? (body.suggestions as Record<string, unknown>)
      : {};
  const optionsSource =
    body.options && typeof body.options === "object" && !Array.isArray(body.options)
      ? (body.options as Record<string, unknown>)
      : {};
  const meta =
    body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : {};

  const readOptions = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .slice(0, 10)
      : [];

  const messageContent = clampText(messageSource.content, 1200);
  const normalized = {
    message: {
      role: "assistant" as const,
      content:
        messageContent ||
        "I can help refine name, personality, background, or physical description.",
    },
    suggestions: {
      name: clampText(suggestionsSource.name, 120) || undefined,
      personality: clampText(suggestionsSource.personality, 1000) || undefined,
      background: clampText(suggestionsSource.background, 1800) || undefined,
      physicalDescription: clampText(suggestionsSource.physicalDescription, 700) || undefined,
    },
    options: {
      nameOptions: readOptions(optionsSource.nameOptions),
      personalityOptions: readOptions(optionsSource.personalityOptions),
      backgroundOptions: readOptions(optionsSource.backgroundOptions),
      physicalDescriptionOptions: readOptions(optionsSource.physicalDescriptionOptions),
    },
    meta,
    warning: undefined as string | undefined,
  };

  const hasSuggestions =
    Boolean(normalized.suggestions.name) ||
    Boolean(normalized.suggestions.personality) ||
    Boolean(normalized.suggestions.background) ||
    Boolean(normalized.suggestions.physicalDescription);
  const hasOptions =
    normalized.options.nameOptions.length > 0 ||
    normalized.options.personalityOptions.length > 0 ||
    normalized.options.backgroundOptions.length > 0 ||
    normalized.options.physicalDescriptionOptions.length > 0;

  if (!messageContent && !hasSuggestions && !hasOptions) {
    normalized.warning = "empty payload";
  } else if (!messageContent) {
    normalized.warning = "missing message content";
  }

  return normalized;
}
