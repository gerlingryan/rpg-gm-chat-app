import { NextRequest, NextResponse } from "next/server";
import {
  generateNextCreatureToken,
  importOpen5eCreatureLibrary,
  listCreatureLibraryEntries,
} from "@/lib/creature-library";

export async function GET(req: NextRequest) {
  const ruleset = req.nextUrl.searchParams.get("ruleset")?.trim() ?? "";
  const creatureType = req.nextUrl.searchParams.get("creatureType")?.trim() ?? "";
  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  const needsTokenOnly =
    req.nextUrl.searchParams.get("needsTokenOnly")?.trim().toLowerCase() === "true";
  const limitRaw = Number.parseInt(req.nextUrl.searchParams.get("limit")?.trim() ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

  try {
    const entries = await listCreatureLibraryEntries({
      ruleset,
      creatureType,
      name,
      limit,
      needsTokenOnly,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load creature library entries.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const typedBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const action =
    typeof typedBody.action === "string" ? typedBody.action.trim().toLowerCase() : "import-open5e";
  if (action === "generate-next-token") {
    const ruleset =
      typeof typedBody.ruleset === "string" && typedBody.ruleset.trim()
        ? typedBody.ruleset.trim()
        : "D&D 5e";
    const style =
      typeof typedBody.style === "string" && typedBody.style.trim()
        ? typedBody.style.trim()
        : "stone-base";
    const creatureType =
      typeof typedBody.creatureType === "string" && typedBody.creatureType.trim()
        ? typedBody.creatureType.trim()
        : "";
    const name =
      typeof typedBody.name === "string" && typedBody.name.trim() ? typedBody.name.trim() : "";
    const forceRegenerate = Boolean(typedBody.forceRegenerate);
    const approved = Boolean(typedBody.approved);

    try {
      const result = await generateNextCreatureToken({
        ruleset,
        style,
        creatureType,
        name,
        forceRegenerate,
        approved,
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to generate next creature token.",
        },
        { status: 500 },
      );
    }
  }

  if (action !== "import-open5e") {
    return NextResponse.json(
      { error: "Unsupported action. Use action='import-open5e' or action='generate-next-token'." },
      { status: 400 },
    );
  }

  const filePath =
    typeof typedBody.filePath === "string" && typedBody.filePath.trim()
      ? typedBody.filePath.trim()
      : "e:\\monster_library\\monsters_wotc_srd.json";
  const ruleset =
    typeof typedBody.ruleset === "string" && typedBody.ruleset.trim()
      ? typedBody.ruleset.trim()
      : "D&D 5e";
  const source =
    typeof typedBody.source === "string" && typedBody.source.trim()
      ? typedBody.source.trim()
      : "open5e";

  try {
    const summary = await importOpen5eCreatureLibrary({
      filePath,
      ruleset,
      source,
    });
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Import failed.",
      },
      { status: 500 },
    );
  }
}
