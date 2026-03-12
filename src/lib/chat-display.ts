export function decodeEscapedNewlines(text: string) {
  let normalized = text;
  for (let index = 0; index < 8; index += 1) {
    const decoded = normalized
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n");
    if (decoded === normalized) {
      break;
    }
    normalized = decoded;
  }
  return normalized;
}

function stripAsteriskMarkup(text: string) {
  return text.replace(/\*/g, "");
}

export function normalizeChoiceFormattingForDisplay(text: string) {
  const normalized = stripAsteriskMarkup(decodeEscapedNewlines(text)).replace(/\r\n/g, "\n");
  const normalizedMarkdownChoices = normalized
    .replace(
      /^\s*\*{1,2}\s*([1-9])\.\s*([\s\S]*?)\s*\*{1,2}\s*$/gm,
      (_match, number: string, choiceText: string) => `${number}. ${choiceText.trim()}`,
    )
    .replace(
      /\*{1,2}\s*([1-9])\.\s*([^*]+?)\s*\*{1,2}/g,
      (_match, number: string, choiceText: string) => `\n${number}. ${choiceText.trim()}\n`,
    );
  const splitInlineChoices = normalizedMarkdownChoices.replace(
    /(^|\n)\s*\*{0,2}([1-9])\.\s+/g,
    (_match, prefix: string, number: string) => `${prefix}${number}. `,
  );
  return splitInlineChoices
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function forceChoiceLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const expandedLines: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trimEnd();
    if (!/^\s*[1-9]\.\s+/.test(line)) {
      expandedLines.push(line);
      continue;
    }
    const inlineChoices = Array.from(
      line.matchAll(/([1-9]\.)\s+([\s\S]*?)(?=\s*[1-9]\.\s+|$)/g),
    )
      .map((match) => `${match[1]} ${match[2].trim()}`.trim())
      .filter(Boolean);

    if (inlineChoices.length >= 2) {
      expandedLines.push(...inlineChoices);
      continue;
    }

    expandedLines.push(line);
  }

  return expandedLines.join("\n");
}

export function normalizeChoiceTextForDisplay(text: string) {
  return forceChoiceLines(normalizeChoiceFormattingForDisplay(text));
}
