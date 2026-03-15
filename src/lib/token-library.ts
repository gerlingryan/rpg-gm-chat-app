import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  buildSceneImagePromptFromSections,
  getSceneImageInstructionTemplate,
  getSceneImageStyleTemplate,
} from "@/lib/map-prompt";

export type TokenEntityType = "character" | "enemy";

type TokenLibraryRecord = {
  id: string;
  entityType: string;
  ruleset: string;
  category: string;
  subtype: string | null;
  normalizedKey: string;
  label: string;
  style: string;
  imageDataUrl: string;
  sourcePrompt: string | null;
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const prismaAny = prisma as unknown as {
  tokenLibraryEntry: {
    findUnique: (args: Record<string, unknown>) => Promise<TokenLibraryRecord | null>;
    findMany: (args: Record<string, unknown>) => Promise<TokenLibraryRecord[]>;
    create: (args: Record<string, unknown>) => Promise<TokenLibraryRecord>;
    update: (args: Record<string, unknown>) => Promise<TokenLibraryRecord>;
    delete: (args: Record<string, unknown>) => Promise<TokenLibraryRecord>;
    upsert: (args: Record<string, unknown>) => Promise<TokenLibraryRecord>;
  };
};

export function normalizeTokenKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function buildDefaultTokenKey(params: {
  entityType: TokenEntityType;
  category?: string;
  subtype?: string;
  label: string;
}) {
  const categoryKey = normalizeTokenKey(params.category ?? "");
  const subtypeKey = normalizeTokenKey(params.subtype ?? "");
  const labelKey = normalizeTokenKey(params.label);
  return [
    params.entityType,
    categoryKey || "general",
    subtypeKey || "base",
    labelKey || "token",
  ].join(":");
}

export async function findTokenLibraryEntry(params: {
  ruleset: string;
  normalizedKey: string;
  style: string;
}) {
  return prismaAny.tokenLibraryEntry.findUnique({
    where: {
      ruleset_normalizedKey_style: {
        ruleset: params.ruleset,
        normalizedKey: params.normalizedKey,
        style: params.style,
      },
    },
  });
}

export async function upsertTokenLibraryEntry(params: {
  entityType: TokenEntityType;
  ruleset: string;
  category?: string;
  subtype?: string;
  normalizedKey: string;
  label: string;
  style: string;
  imageDataUrl: string;
  sourcePrompt?: string;
  approved?: boolean;
}) {
  return prismaAny.tokenLibraryEntry.upsert({
    where: {
      ruleset_normalizedKey_style: {
        ruleset: params.ruleset,
        normalizedKey: params.normalizedKey,
        style: params.style,
      },
    },
    create: {
      entityType: params.entityType,
      ruleset: params.ruleset,
      category: (params.category ?? "general").trim() || "general",
      subtype: (params.subtype ?? "").trim() || null,
      normalizedKey: params.normalizedKey,
      label: params.label,
      style: params.style,
      imageDataUrl: params.imageDataUrl,
      sourcePrompt: params.sourcePrompt ?? null,
      approved: params.approved ?? false,
    },
    update: {
      entityType: params.entityType,
      category: (params.category ?? "general").trim() || "general",
      subtype: (params.subtype ?? "").trim() || null,
      label: params.label,
      imageDataUrl: params.imageDataUrl,
      sourcePrompt: params.sourcePrompt ?? null,
      approved: params.approved ?? false,
    },
  });
}

export function buildTokenPrompt(params: {
  ruleset: string;
  label: string;
  customDescription: string;
  style: string;
  instructions?: string;
}) {
  const noScenicBaseMode = params.style === "no-scenic-base";
  const noScenicBaseInstruction =
    "TRUE TOP-DOWN TOKEN CUTOUT. Strict 90° overhead, orthographic/parallel projection, zero perspective, no tilt, no horizon. Square image, centered, full miniature visible. HARD REQUIREMENT: no base, no pedestal, no plinth, no scenic disk, no terrain stand. Character must be a clean cutout token with transparent background.";
  const noScenicBaseOverride =
    noScenicBaseMode
      ? "ENFORCEMENT: remove any visible base completely. Absolutely forbid stone/cobblestone/flagstones, cracks, dirt/mud/sand, grass/tufts, debris/props, round base rims, pedestals, stands, plinths."
      : "";
  const styleDescription = noScenicBaseMode
    ? "Style: highly detailed painted 3D tabletop miniature character only (hand-painted mini look), crisp edges, clean shading. No base geometry. No ground plane. Transparent around the character silhouette.\nNegative:\nvisible base, circular base, black rim, pedestal, plinth, stand, scenic base, terrain texture, stone base, cobblestone base, dirt base, grassy base, debris, props, isometric, 3/4 view, angled camera, perspective, tilt, low angle, front view, portrait, readable face, visible eyes, looking at camera, horizon, cinematic angle, cropped, off-center, zoomed-in, zoomed-out, blurry, lowres, extra limbs, extra fingers, duplicate body, multiple characters, text, watermark, logo."
    : getSceneImageStyleTemplate(
        params.style as Parameters<typeof getSceneImageStyleTemplate>[0],
      );
  return buildSceneImagePromptFromSections({
    instructions:
      params.instructions?.trim() ||
      (noScenicBaseMode
        ? noScenicBaseInstruction
        : getSceneImageInstructionTemplate("character-token", params.ruleset)),
    customDescription: [
      params.customDescription.trim() ||
        `Character name: ${params.label}. Top-down tabletop token silhouette.`,
      noScenicBaseOverride,
    ]
      .filter(Boolean)
      .join(" "),
    styleDescription,
  });
}

export async function generateTokenImageDataUrl(params: {
  prompt: string;
  forceOpaque?: boolean;
}) {
  const run = async (withTransparentBackground: boolean) => {
    const imageResponse = (await openai.images.generate({
      model: "gpt-image-1-mini",
      size: "1024x1024",
      prompt: params.prompt,
      ...(withTransparentBackground ? { transparent_background: true } : {}),
    } as never)) as unknown as {
      data?: Array<{
        b64_json?: string | null;
      }>;
    };
    return imageResponse.data?.[0]?.b64_json ?? null;
  };

  let b64Json: string | null = null;
  if (params.forceOpaque) {
    b64Json = await run(false);
  } else {
    try {
      b64Json = await run(true);
    } catch {
      b64Json = await run(false);
    }
    if (!b64Json) {
      b64Json = await run(false);
    }
  }

  if (!b64Json) {
    throw new Error("Unable to generate token image.");
  }

  return `data:image/png;base64,${b64Json}`;
}

export async function findOrGenerateToken(params: {
  entityType: TokenEntityType;
  ruleset: string;
  category?: string;
  subtype?: string;
  normalizedKey: string;
  label: string;
  customDescription: string;
  style: string;
  instructions?: string;
  forceRegenerate?: boolean;
  approved?: boolean;
}) {
  if (!params.forceRegenerate) {
    const existing = await findTokenLibraryEntry({
      ruleset: params.ruleset,
      normalizedKey: params.normalizedKey,
      style: params.style,
    });
    if (existing?.imageDataUrl) {
      return {
        token: existing,
        cacheHit: true,
      };
    }
  }

  const prompt = buildTokenPrompt({
    ruleset: params.ruleset,
    label: params.label,
    customDescription: params.customDescription,
    style: params.style,
    instructions: params.instructions,
  });

  const imageDataUrl = await generateTokenImageDataUrl({
    prompt,
  });

  const token = await upsertTokenLibraryEntry({
    entityType: params.entityType,
    ruleset: params.ruleset,
    category: params.category,
    subtype: params.subtype,
    normalizedKey: params.normalizedKey,
    label: params.label,
    style: params.style,
    imageDataUrl,
    sourcePrompt: prompt,
    approved: params.approved ?? false,
  });

  return {
    token,
    cacheHit: false,
  };
}

export async function listTokenLibraryEntries(params: {
  ruleset?: string;
  entityType?: string;
  category?: string;
  subtype?: string;
  normalizedKey?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};
  if (params.ruleset?.trim()) {
    where.ruleset = { equals: params.ruleset.trim(), mode: "insensitive" };
  }
  if (params.entityType?.trim()) {
    where.entityType = { equals: params.entityType.trim(), mode: "insensitive" };
  }
  if (params.category?.trim()) {
    where.category = { equals: params.category.trim(), mode: "insensitive" };
  }
  if (params.subtype?.trim()) {
    where.subtype = { equals: params.subtype.trim(), mode: "insensitive" };
  }
  if (params.normalizedKey?.trim()) {
    where.normalizedKey = {
      contains: normalizeTokenKey(params.normalizedKey),
      mode: "insensitive",
    };
  }

  return prismaAny.tokenLibraryEntry.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(200, params.limit ?? 100)),
  });
}
