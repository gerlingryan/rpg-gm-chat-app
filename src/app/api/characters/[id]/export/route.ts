import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withDerivedBehaviorSummary } from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function buildLibrarySafeSheet(sheetJson: unknown) {
  const sourceSheet =
    sheetJson && typeof sheetJson === "object" && !Array.isArray(sheetJson)
      ? { ...(sheetJson as Record<string, unknown>) }
      : {};

  delete sourceSheet.source;
  delete sourceSheet.ammo;
  delete sourceSheet.spellSlots;

  sourceSheet.statusEffects = [];
  sourceSheet.temporaryBuffs = [];
  sourceSheet.temporaryDebuffs = [];

  const hp = sourceSheet.hp;
  if (hp && typeof hp === "object" && !Array.isArray(hp)) {
    const typedHp = hp as Record<string, unknown>;

    if ("max" in typedHp) {
      sourceSheet.hp = {
        ...typedHp,
        current: typedHp.max,
      };
    }
  }

  const wounds = sourceSheet.wounds;
  if (wounds && typeof wounds === "object" && !Array.isArray(wounds)) {
    const typedWounds = wounds as Record<string, unknown>;

    if ("threshold" in typedWounds) {
      sourceSheet.wounds = {
        ...typedWounds,
        current: 0,
      };
    }
  }

  const health = sourceSheet.health;
  if (health && typeof health === "object" && !Array.isArray(health)) {
    const typedHealth = health as Record<string, unknown>;

    if ("max" in typedHealth) {
      sourceSheet.health = {
        ...typedHealth,
        current: typedHealth.max,
      };
    }
  }

  return sourceSheet;
}

async function buildUniqueLibraryCharacterName(baseName: string) {
  const existingCharacters = await prisma.libraryCharacter.findMany({
    where: {
      name: {
        startsWith: baseName,
        mode: "insensitive",
      },
    },
    select: {
      name: true,
    },
  });

  const normalizedExistingNames = new Set(
    existingCharacters.map((character) => character.name.trim().toLowerCase()),
  );

  if (!normalizedExistingNames.has(baseName.trim().toLowerCase())) {
    return baseName;
  }

  let suffix = 2;

  while (normalizedExistingNames.has(`${baseName} ${suffix}`.trim().toLowerCase())) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const mode =
    body.mode === "create-version" ? "create-version" : "update-master";
  const requestedName =
    typeof body.name === "string" ? body.name.trim() : "";

  const character = await prisma.character.findUnique({
    where: { id },
    include: {
      originLibraryCharacter: true,
      campaign: true,
    },
  });

  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }

  const exportSheet = buildLibrarySafeSheet(character.sheetJson);
  const finalizedExportSheet = withDerivedBehaviorSummary(
    exportSheet,
    character.name,
    character.memorySummary,
  );

  if (mode === "update-master") {
    if (!character.originLibraryCharacterId || !character.originLibraryCharacter) {
      return NextResponse.json(
        { error: "This character does not have a linked master record." },
        { status: 400 },
      );
    }

    const updatedCharacter = await prisma.libraryCharacter.update({
      where: { id: character.originLibraryCharacterId },
      data: {
        name: character.name,
        role: character.role,
        sheetJson: finalizedExportSheet,
        memorySummary: character.originLibraryCharacter.memorySummary,
      },
    });

    return NextResponse.json({
      character: updatedCharacter,
      mode,
    });
  }

  const baseName = requestedName || `${character.name} (Exported)`;
  const uniqueName = await buildUniqueLibraryCharacterName(baseName);
  const createdCharacter = await prisma.libraryCharacter.create({
    data: {
      name: uniqueName,
      ruleset: character.campaign.ruleset,
      role: character.role,
      sheetJson: finalizedExportSheet,
      memorySummary: `Exported from ${character.campaign.title}.`,
    },
  });

  return NextResponse.json({
    character: createdCharacter,
    mode,
  });
}
