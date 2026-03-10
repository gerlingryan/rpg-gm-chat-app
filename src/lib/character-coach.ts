export type CoachFieldId = "personality" | "background" | "physicalDescription";

export function extractRequestedOptionCount(message: string) {
  const explicitNumber = message.match(/\b(\d{1,2})\s+(?:personality\s+)?options?\b/i);
  if (explicitNumber) {
    const parsed = Number(explicitNumber[1]);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10, Math.trunc(parsed)));
    }
  }
  if (/\bseveral\b/i.test(message) || /\bfew\b/i.test(message)) {
    return 3;
  }
  return null;
}

export function extractRequestedFields(message: string) {
  const lower = message.toLowerCase();
  const requested = new Set<CoachFieldId>();

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
  personalityCount: number;
  backgroundCount: number;
  physicalCount: number;
}) {
  const headers: string[] = [];
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
  return `${params.reply}\n\nSections: ${headers.join(" • ")} options`;
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
      content: messageContent || "I can help refine personality, background, or physical description.",
    },
    suggestions: {
      personality: clampText(suggestionsSource.personality, 1000) || undefined,
      background: clampText(suggestionsSource.background, 1800) || undefined,
      physicalDescription: clampText(suggestionsSource.physicalDescription, 700) || undefined,
    },
    options: {
      personalityOptions: readOptions(optionsSource.personalityOptions),
      backgroundOptions: readOptions(optionsSource.backgroundOptions),
      physicalDescriptionOptions: readOptions(optionsSource.physicalDescriptionOptions),
    },
    meta,
    warning: undefined as string | undefined,
  };

  const hasSuggestions =
    Boolean(normalized.suggestions.personality) ||
    Boolean(normalized.suggestions.background) ||
    Boolean(normalized.suggestions.physicalDescription);
  const hasOptions =
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
