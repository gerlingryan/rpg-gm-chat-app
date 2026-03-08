"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { LibraryCharacterBuilder } from "@/components/LibraryCharacterBuilder";

type LibraryCharacter = {
  id: string;
  name: string;
  ruleset: string;
  sheetJson: Record<string, unknown> | null;
};

function buildInitialAnswersFromSheet(
  ruleset: string,
  sheetJson: Record<string, unknown> | null,
) {
  if (!sheetJson || typeof sheetJson !== "object" || Array.isArray(sheetJson)) {
    return {};
  }

  const currentAnswers = Object.entries(sheetJson).reduce<Record<string, string | number>>(
    (answers, [key, value]) => {
      if (typeof value === "string" || typeof value === "number") {
        answers[key] = value;
      }

      return answers;
    },
    {},
  );

  if (
    sheetJson.stats &&
    typeof sheetJson.stats === "object" &&
    !Array.isArray(sheetJson.stats)
  ) {
    for (const [key, value] of Object.entries(
      sheetJson.stats as Record<string, unknown>,
    )) {
      if (typeof value === "string" || typeof value === "number") {
        currentAnswers[key] = value;
      }
    }
  }

  if (
    sheetJson.traits &&
    typeof sheetJson.traits === "object" &&
    !Array.isArray(sheetJson.traits)
  ) {
    for (const [key, value] of Object.entries(
      sheetJson.traits as Record<string, unknown>,
    )) {
      if (typeof value === "string" || typeof value === "number") {
        currentAnswers[key] = value;
      }
    }
  }

  if (
    ruleset.trim().toLowerCase() === "d&d 5e" &&
    sheetJson.spells &&
    typeof sheetJson.spells === "object" &&
    !Array.isArray(sheetJson.spells)
  ) {
    const spellData = sheetJson.spells as Record<string, unknown>;
    const cantrips = Array.isArray(spellData.cantrips)
      ? spellData.cantrips.filter(
          (spell): spell is string => typeof spell === "string" && spell.trim().length > 0,
        )
      : [];
    const byLevel =
      spellData.byLevel &&
      typeof spellData.byLevel === "object" &&
      !Array.isArray(spellData.byLevel)
        ? (spellData.byLevel as Record<string, unknown>)
        : {};
    const level1 = Array.isArray(byLevel.level1)
      ? byLevel.level1.filter(
          (spell): spell is string => typeof spell === "string" && spell.trim().length > 0,
        )
      : [];
    const level2 = Array.isArray(byLevel.level2)
      ? byLevel.level2.filter(
          (spell): spell is string => typeof spell === "string" && spell.trim().length > 0,
        )
      : [];
    const level3 = Array.isArray(byLevel.level3)
      ? byLevel.level3.filter(
          (spell): spell is string => typeof spell === "string" && spell.trim().length > 0,
        )
      : [];

    if (cantrips[0]) currentAnswers.cantripOne = cantrips[0];
    if (cantrips[1]) currentAnswers.cantripTwo = cantrips[1];
    if (cantrips[2]) currentAnswers.cantripThree = cantrips[2];
    if (level1[0]) currentAnswers.spellLevel1A = level1[0];
    if (level1[1]) currentAnswers.spellLevel1B = level1[1];
    if (level2[0]) currentAnswers.spellLevel2A = level2[0];
    if (level2[1]) currentAnswers.spellLevel2B = level2[1];
    if (level3[0]) currentAnswers.spellLevel3A = level3[0];
  }

  if (ruleset.trim().toLowerCase() === "d&d 5e") {
    const characterClass =
      typeof sheetJson.class === "string" ? sheetJson.class.trim() : "";
    const subclass =
      typeof sheetJson.subclass === "string" ? sheetJson.subclass.trim() : "";

    const subclassFieldByClass: Record<string, string> = {
      Barbarian: "barbarianPath",
      Bard: "bardCollege",
      Cleric: "clericDomain",
      Druid: "druidCircle",
      Fighter: "fighterArchetype",
      Monk: "monasticTradition",
      Paladin: "paladinOath",
      Ranger: "rangerConclave",
      Rogue: "roguishArchetype",
      Sorcerer: "sorcerousOrigin",
      Warlock: "warlockPatron",
      Wizard: "arcaneTradition",
    };

    if (
      characterClass &&
      subclass &&
      !/^none yet$/i.test(subclass) &&
      subclassFieldByClass[characterClass]
    ) {
      currentAnswers[subclassFieldByClass[characterClass]] = subclass;
    }

    if (Array.isArray(sheetJson.classFeatures)) {
      for (const feature of sheetJson.classFeatures) {
        if (typeof feature !== "string") {
          continue;
        }

        const fightingStyleMatch = feature.match(
          /^Fighting Style(?::| training:)\s*(.+)$/i,
        );
        if (fightingStyleMatch?.[1]) {
          currentAnswers.fightingStyle = fightingStyleMatch[1].trim();
        }

        const rogueFocusMatch = feature.match(/^Expert focus:\s*(.+)$/i);
        if (rogueFocusMatch?.[1]) {
          currentAnswers.rogueTalent = rogueFocusMatch[1].trim();
        }
      }
    }
  }

  if (ruleset.trim().toLowerCase() === "deadlands classic") {
    if (
      sheetJson.fateChips &&
      typeof sheetJson.fateChips === "object" &&
      !Array.isArray(sheetJson.fateChips)
    ) {
      const fateChips = sheetJson.fateChips as Record<string, unknown>;
      const fateMap: Array<[string, string]> = [
        ["white", "fateWhite"],
        ["red", "fateRed"],
        ["blue", "fateBlue"],
        ["legend", "fateLegend"],
      ];

      for (const [sourceKey, answerKey] of fateMap) {
        const value = fateChips[sourceKey];
        if (typeof value === "number") {
          currentAnswers[answerKey] = value;
        }
      }
    }

    if (!("fateWhite" in currentAnswers)) currentAnswers.fateWhite = 2;
    if (!("fateRed" in currentAnswers)) currentAnswers.fateRed = 1;
    if (!("fateBlue" in currentAnswers)) currentAnswers.fateBlue = 0;
    if (!("fateLegend" in currentAnswers)) currentAnswers.fateLegend = 0;

    if (
      sheetJson.woundsByLocation &&
      typeof sheetJson.woundsByLocation === "object" &&
      !Array.isArray(sheetJson.woundsByLocation)
    ) {
      const woundsByLocation = sheetJson.woundsByLocation as Record<string, unknown>;
      const locationMap: Array<[string, string]> = [
        ["head", "woundHead"],
        ["guts", "woundGuts"],
        ["leftArm", "woundLeftArm"],
        ["rightArm", "woundRightArm"],
        ["leftLeg", "woundLeftLeg"],
        ["rightLeg", "woundRightLeg"],
      ];

      for (const [sourceKey, answerKey] of locationMap) {
        const value = woundsByLocation[sourceKey];
        if (typeof value === "number") {
          currentAnswers[answerKey] = value;
        }
      }
    } else if (
      !("woundHead" in currentAnswers) &&
      sheetJson.wounds &&
      typeof sheetJson.wounds === "object" &&
      !Array.isArray(sheetJson.wounds)
    ) {
      const wounds = sheetJson.wounds as Record<string, unknown>;
      const migratedCurrent =
        typeof wounds.current === "number"
          ? wounds.current
          : typeof wounds.current === "string"
            ? Number(wounds.current)
            : 0;
      const safeCurrent = Number.isFinite(migratedCurrent) ? Math.max(0, Math.min(4, migratedCurrent)) : 0;
      currentAnswers.woundHead = 0;
      currentAnswers.woundGuts = safeCurrent;
      currentAnswers.woundLeftArm = 0;
      currentAnswers.woundRightArm = 0;
      currentAnswers.woundLeftLeg = 0;
      currentAnswers.woundRightLeg = 0;
    }

    const hasEdgeOne =
      typeof currentAnswers.edgeOne === "string" &&
      currentAnswers.edgeOne.trim().length > 0;
    const hasEdgeTwo =
      typeof currentAnswers.edgeTwo === "string" &&
      currentAnswers.edgeTwo.trim().length > 0;
    if ((!hasEdgeOne || !hasEdgeTwo) && Array.isArray(sheetJson.edges)) {
      const edges = (sheetJson.edges as unknown[]).filter(
        (edge): edge is string => typeof edge === "string" && edge.trim().length > 0,
      );
      const distinctEdges = [...new Set(edges.map((edge) => edge.trim()))];
      if (!hasEdgeOne && distinctEdges[0]) {
        currentAnswers.edgeOne = distinctEdges[0];
      }
      if (!hasEdgeTwo) {
        const secondEdge = distinctEdges.find((edge) => edge !== currentAnswers.edgeOne);
        currentAnswers.edgeTwo = secondEdge ?? "None";
      }
    }

    const hasHindranceOne =
      typeof currentAnswers.hindranceOne === "string" &&
      currentAnswers.hindranceOne.trim().length > 0;
    const hasHindranceTwo =
      typeof currentAnswers.hindranceTwo === "string" &&
      currentAnswers.hindranceTwo.trim().length > 0;
    if ((!hasHindranceOne || !hasHindranceTwo) && Array.isArray(sheetJson.hinderances)) {
      const hinderances = (sheetJson.hinderances as unknown[]).filter(
        (hindrance): hindrance is string =>
          typeof hindrance === "string" && hindrance.trim().length > 0,
      );
      const distinctHindrances = [...new Set(hinderances.map((entry) => entry.trim()))];
      if (!hasHindranceOne && distinctHindrances[0]) {
        currentAnswers.hindranceOne = distinctHindrances[0];
      }
      if (!hasHindranceTwo) {
        const secondHindrance = distinctHindrances.find(
          (entry) => entry !== currentAnswers.hindranceOne,
        );
        currentAnswers.hindranceTwo = secondHindrance ?? "None";
      }
    }

    if (
      typeof currentAnswers.arcanePool !== "number" &&
      sheetJson.arcane &&
      typeof sheetJson.arcane === "object" &&
      !Array.isArray(sheetJson.arcane)
    ) {
      const arcaneData = sheetJson.arcane as Record<string, unknown>;
      if (typeof arcaneData.points === "number") {
        currentAnswers.arcanePool = arcaneData.points;
      }
    }

    if (
      sheetJson.arcane &&
      typeof sheetJson.arcane === "object" &&
      !Array.isArray(sheetJson.arcane)
    ) {
      const arcaneData = sheetJson.arcane as Record<string, unknown>;
      const arcanePowers = Array.isArray(arcaneData.powers)
        ? arcaneData.powers.filter(
            (power): power is string =>
              typeof power === "string" && power.trim().length > 0,
          )
        : [];
      const firstPower = arcanePowers[0] ?? "";
      const secondPower = arcanePowers[1] ?? "None";
      const archetype =
        typeof currentAnswers.archetype === "string" ? currentAnswers.archetype : "";

      if (archetype === "Blessed") {
        if (
          typeof currentAnswers.blessedMiracleOne !== "string" ||
          !currentAnswers.blessedMiracleOne.trim()
        ) {
          currentAnswers.blessedMiracleOne = firstPower || "Smite";
        }
        if (
          typeof currentAnswers.blessedMiracleTwo !== "string" ||
          !currentAnswers.blessedMiracleTwo.trim()
        ) {
          currentAnswers.blessedMiracleTwo = secondPower || "None";
        }
      } else if (archetype === "Huckster") {
        if (
          typeof currentAnswers.hucksterHexOne !== "string" ||
          !currentAnswers.hucksterHexOne.trim()
        ) {
          currentAnswers.hucksterHexOne = firstPower || "Soul Blast";
        }
        if (
          typeof currentAnswers.hucksterHexTwo !== "string" ||
          !currentAnswers.hucksterHexTwo.trim()
        ) {
          currentAnswers.hucksterHexTwo = secondPower || "None";
        }
      } else if (archetype === "Shaman") {
        if (
          typeof currentAnswers.shamanFavorOne !== "string" ||
          !currentAnswers.shamanFavorOne.trim()
        ) {
          currentAnswers.shamanFavorOne = firstPower || "Spirit Warrior";
        }
        if (
          typeof currentAnswers.shamanFavorTwo !== "string" ||
          !currentAnswers.shamanFavorTwo.trim()
        ) {
          currentAnswers.shamanFavorTwo = secondPower || "None";
        }
      } else if (archetype === "Mad Scientist") {
        if (
          typeof currentAnswers.madScienceInventionOne !== "string" ||
          !currentAnswers.madScienceInventionOne.trim()
        ) {
          currentAnswers.madScienceInventionOne = firstPower || "Electrostatic Projector";
        }
        if (
          typeof currentAnswers.madScienceInventionTwo !== "string" ||
          !currentAnswers.madScienceInventionTwo.trim()
        ) {
          currentAnswers.madScienceInventionTwo = secondPower || "None";
        }
      }
    }

    const hasPrimary =
      typeof currentAnswers.primarySkill === "string" &&
      currentAnswers.primarySkill.trim().length > 0;
    const hasSecondary =
      typeof currentAnswers.secondarySkill === "string" &&
      currentAnswers.secondarySkill.trim().length > 0;

    if ((!hasPrimary || !hasSecondary) && Array.isArray(sheetJson.skills)) {
      const skills = (sheetJson.skills as unknown[]).filter(
        (skill): skill is string => typeof skill === "string" && skill.trim().length > 0,
      );
      const distinctSkills = [...new Set(skills.map((skill) => skill.trim()))];

      if (!hasPrimary && distinctSkills[0]) {
        currentAnswers.primarySkill = distinctSkills[0];
      }

      if (!hasSecondary) {
        const fallbackSecondary = distinctSkills.find(
          (skill) => skill !== currentAnswers.primarySkill,
        );
        if (fallbackSecondary) {
          currentAnswers.secondarySkill = fallbackSecondary;
        }
      }
    }

    if (
      typeof currentAnswers.primarySkill === "string" &&
      typeof currentAnswers.secondarySkill === "string" &&
      currentAnswers.primarySkill === currentAnswers.secondarySkill
    ) {
      const fallbackSecondaryOptions = ["Dodge", "Guts", "Fightin'", "Scrutinize"];
      const distinctFallback = fallbackSecondaryOptions.find(
        (skill) => skill !== currentAnswers.primarySkill,
      );
      if (distinctFallback) {
        currentAnswers.secondarySkill = distinctFallback;
      }
    }
  }

  return currentAnswers;
}

export default function EditCharacterPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const characterId = params.id as string;
  const returnTo = searchParams.get("returnTo")?.trim() || "/characters";
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!characterId) {
      return;
    }

    async function loadCharacter() {
      try {
        setError("");

        const response = await fetch(`/api/library-characters/${characterId}`);
        const data = await response.json();

        if (!response.ok || !data.character) {
          throw new Error(data.error ?? "Unable to load library character.");
        }

        setCharacter(data.character as LibraryCharacter);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load library character.",
        );
      }
    }

    loadCharacter();
  }, [characterId]);

  const initialAnswers = useMemo(
    () =>
      character
        ? buildInitialAnswersFromSheet(character.ruleset, character.sheetJson)
        : {},
    [character],
  );

  if (!character && !error) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 text-sm text-slate-300 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          Loading character...
        </div>
      </main>
    );
  }

  if (!character) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-red-400/30 bg-red-400/10 p-6 text-sm text-red-200 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          {error}
        </div>
      </main>
    );
  }

  return (
    <LibraryCharacterBuilder
      mode="edit"
      initialRuleset={character.ruleset}
      rulesetLocked
      initialName={character.name}
      initialAnswers={initialAnswers}
      submitUrl={`/api/library-characters/${characterId}`}
      submitMethod="PATCH"
      returnTo={returnTo}
      backHref={returnTo}
      backLabel="Back to Library"
      headingKicker="Character Library"
      headingTitle="Edit Reusable Character"
      headingDescription="Update this reusable library character and future campaign imports will use the new version."
    />
  );
}
