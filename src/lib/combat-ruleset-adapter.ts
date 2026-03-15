type SheetLike = Record<string, unknown> | null | undefined;

type CharacterLike = {
  id: string;
  name: string;
  sheetJson: Record<string, unknown> | null;
};

type CombatantRuntimeLike = {
  armorClass?: number;
  attackBonusOverride?: number;
  damageDieOverride?: number;
  damageBonusOverride?: number;
};

export type InitiativeContext = {
  ruleset: string;
  rosterType: "character" | "enemy" | "npc";
  character: CharacterLike | null;
  explicitModifier?: number;
};

export type AttackDefaultsContext = {
  ruleset: string;
  actorType: "character" | "enemy" | "npc";
  actorCharacter: CharacterLike | null;
  targetCharacter: CharacterLike | null;
  actorRuntime?: CombatantRuntimeLike | null;
  targetRuntime?: CombatantRuntimeLike | null;
};

export type AttackDefaults = {
  attackDie: number;
  attackBonus: number;
  targetAc: number;
  damageDie: number;
  damageBonus: number;
};

function normalizeRulesetKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isDndRuleset(value: string) {
  const normalized = normalizeRulesetKey(value);
  return normalized.includes("d&d") || normalized.includes("dnd");
}

function isDeadlandsRuleset(value: string) {
  return normalizeRulesetKey(value).includes("deadlands");
}

function isSavageRiftsRuleset(value: string) {
  const normalized = normalizeRulesetKey(value);
  return normalized.includes("savage rifts") || normalized.includes("rifts");
}

export function getCombatRulesetProfile(value: string) {
  if (isDndRuleset(value)) {
    return "dnd";
  }
  if (isDeadlandsRuleset(value)) {
    return "deadlands";
  }
  return "generic";
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getNestedValue(source: SheetLike, path: string[]) {
  let cursor: unknown = source;
  for (const key of path) {
    const cursorObject = asObject(cursor);
    if (!cursorObject || !(key in cursorObject)) {
      return null;
    }
    cursor = cursorObject[key];
  }
  return cursor;
}

function getFirstNumber(source: SheetLike, candidatePaths: string[][]) {
  for (const path of candidatePaths) {
    const value = getNestedValue(source, path);
    const parsed = parseFiniteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function getCharacterLevel(sheet: SheetLike) {
  const directLevel = getFirstNumber(sheet, [["level"]]);
  if (directLevel !== null) {
    return Math.max(1, Math.trunc(directLevel));
  }
  const nestedLevel = getFirstNumber(sheet, [
    ["stats", "level"],
    ["derivedStats", "level"],
  ]);
  if (nestedLevel !== null) {
    return Math.max(1, Math.trunc(nestedLevel));
  }
  return 1;
}

function parseDamageExpression(value: string) {
  const trimmed = value.trim().toLowerCase();
  const diceMatch = trimmed.match(/(\d+)\s*d\s*(\d+)/);
  const bonusMatch = trimmed.match(/([+-])\s*(\d+)/);
  const diceCount = diceMatch ? Math.max(1, Math.trunc(Number(diceMatch[1]))) : 1;
  const diceSides = diceMatch ? Math.max(4, Math.trunc(Number(diceMatch[2]))) : 6;
  const bonus = bonusMatch
    ? (bonusMatch[1] === "-" ? -1 : 1) * Math.trunc(Number(bonusMatch[2]))
    : 0;
  const approximateExtraDiceBonus =
    diceCount > 1 ? (diceCount - 1) * Math.round((diceSides + 1) / 2) : 0;

  return {
    damageDie: clampInteger(diceSides, 4, 20),
    damageBonus: clampInteger(bonus + approximateExtraDiceBonus, -10, 30),
  };
}

function getStringValue(source: SheetLike, path: string[]) {
  const value = getNestedValue(source, path);
  return typeof value === "string" ? value.trim() : "";
}

function getStringArrayValue(source: SheetLike, path: string[]) {
  const value = getNestedValue(source, path);
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim());
}

function scoreDeadlandsSkillMatch(sheet: SheetLike, terms: string[]) {
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const primarySkill = getStringValue(sheet, ["primarySkill"]).toLowerCase();
  const secondarySkill = getStringValue(sheet, ["secondarySkill"]).toLowerCase();
  const skills = getStringArrayValue(sheet, ["skills"]).map((entry) => entry.toLowerCase());

  const matches = (value: string) => normalizedTerms.some((term) => value.includes(term));

  if (primarySkill && matches(primarySkill)) {
    return 2;
  }
  if (secondarySkill && matches(secondarySkill)) {
    return 1;
  }
  if (skills.some((skill) => matches(skill))) {
    return 1;
  }
  return 0;
}

function deadlandsTraitToDieSides(traitValue: number | null) {
  if (traitValue === null) {
    return 8;
  }
  const clamped = clampInteger(traitValue, 1, 5);
  return 2 * clamped + 2; // 1->d4, 2->d6, 3->d8, 4->d10, 5->d12
}

function normalizeWeaponName(value: string) {
  return value.trim().toLowerCase();
}

function inferDeadlandsWeaponDamage(weaponName: string) {
  const normalized = normalizeWeaponName(weaponName);
  if (!normalized || normalized === "none") {
    return { damageDie: 6, damageBonus: 0 };
  }
  if (/(revolver|peacemaker|schofield|pistol)/.test(normalized)) {
    return { damageDie: 6, damageBonus: 1 };
  }
  if (/(rifle|repeater|longarm|carbine)/.test(normalized)) {
    return { damageDie: 8, damageBonus: 1 };
  }
  if (/(shotgun)/.test(normalized)) {
    return { damageDie: 10, damageBonus: 0 };
  }
  if (/(knife|dagger)/.test(normalized)) {
    return { damageDie: 4, damageBonus: 1 };
  }
  if (/(saber|sword|axe|club|tomahawk)/.test(normalized)) {
    return { damageDie: 8, damageBonus: 1 };
  }
  if (/(fist|brawl|unarmed)/.test(normalized)) {
    return { damageDie: 4, damageBonus: 0 };
  }
  return { damageDie: 6, damageBonus: 0 };
}

function getDeadlandsWeaponProfile(sheet: SheetLike) {
  const sheetObject = asObject(sheet);
  if (!sheetObject) {
    return null;
  }

  const attackProfiles = asObject(sheetObject.attackProfiles);
  const mainHand = getStringValue(sheet, ["mainHand"]);
  const longarm = getStringValue(sheet, ["longarm"]);

  const preferredKeys = [mainHand, "mainHand", longarm, "longarm"]
    .map((value) => normalizeWeaponName(value))
    .filter(Boolean);

  if (attackProfiles) {
    for (const [profileKey, profileValue] of Object.entries(attackProfiles)) {
      if (!profileValue || typeof profileValue !== "object" || Array.isArray(profileValue)) {
        continue;
      }
      const typedProfile = profileValue as Record<string, unknown>;
      const profileWeapon =
        typeof typedProfile.weapon === "string" && typedProfile.weapon.trim()
          ? typedProfile.weapon.trim()
          : profileKey;
      const normalizedProfileKey = normalizeWeaponName(profileKey);
      const normalizedProfileWeapon = normalizeWeaponName(profileWeapon);
      if (
        preferredKeys.length > 0 &&
        !preferredKeys.includes(normalizedProfileKey) &&
        !preferredKeys.includes(normalizedProfileWeapon)
      ) {
        continue;
      }

      const attackBonus = parseFiniteNumber(typedProfile.attackBonus);
      const parsedDamage = parseDamageExpression(
        typeof typedProfile.damage === "string" ? typedProfile.damage : "",
      );

      return {
        weaponName: profileWeapon,
        attackBonus: attackBonus !== null ? clampInteger(attackBonus, -10, 15) : null,
        damageDie: parsedDamage.damageDie,
        damageBonus: parsedDamage.damageBonus,
      };
    }

    const firstProfile = Object.entries(attackProfiles).find(
      ([, value]) => value && typeof value === "object" && !Array.isArray(value),
    );
    if (firstProfile) {
      const typedProfile = firstProfile[1] as Record<string, unknown>;
      const profileWeapon =
        typeof typedProfile.weapon === "string" && typedProfile.weapon.trim()
          ? typedProfile.weapon.trim()
          : firstProfile[0];
      const attackBonus = parseFiniteNumber(typedProfile.attackBonus);
      const parsedDamage = parseDamageExpression(
        typeof typedProfile.damage === "string" ? typedProfile.damage : "",
      );

      return {
        weaponName: profileWeapon,
        attackBonus: attackBonus !== null ? clampInteger(attackBonus, -10, 15) : null,
        damageDie: parsedDamage.damageDie,
        damageBonus: parsedDamage.damageBonus,
      };
    }
  }

  const weaponName = mainHand && normalizeWeaponName(mainHand) !== "none" ? mainHand : longarm;
  return {
    weaponName,
    attackBonus: null,
    ...inferDeadlandsWeaponDamage(weaponName),
  };
}

function getDeadlandsStoredSkillDie(
  sheet: SheetLike,
  keyCandidates: string[],
) {
  const skillDiceObject = asObject(getNestedValue(sheet, ["skillDice"]));
  if (skillDiceObject) {
    for (const key of keyCandidates) {
      if (key in skillDiceObject) {
        const parsed = parseFiniteNumber(skillDiceObject[key]);
        if (parsed !== null) {
          return clampInteger(parsed, 4, 20);
        }
      }
    }
  }
  return null;
}

export function findCharacterByRef(characters: CharacterLike[], ref: string) {
  const normalizedRef = normalizeLookup(ref);
  return (
    characters.find((character) => normalizeLookup(character.id) === normalizedRef) ??
    characters.find((character) => normalizeLookup(character.name) === normalizedRef) ??
    null
  );
}

export function getInitiativeModifier(context: InitiativeContext) {
  if (typeof context.explicitModifier === "number" && Number.isFinite(context.explicitModifier)) {
    return clampInteger(context.explicitModifier, -20, 20);
  }

  const sheet = context.character?.sheetJson;

  const commonInitiative = getFirstNumber(sheet, [
    ["initiativeModifier"],
    ["initiative", "modifier"],
    ["initiative", "mod"],
  ]);
  if (commonInitiative !== null) {
    return clampInteger(commonInitiative, -20, 20);
  }

  if (isDndRuleset(context.ruleset)) {
    const dexModifier = getFirstNumber(sheet, [
      ["abilities", "dex", "modifier"],
      ["attributes", "dexterity", "modifier"],
      ["dexterity", "modifier"],
      ["dexterityMod"],
      ["dexMod"],
    ]);
    if (dexModifier !== null) {
      return clampInteger(dexModifier, -10, 15);
    }
    return context.rosterType === "enemy" ? 1 : 2;
  }

  if (isDeadlandsRuleset(context.ruleset)) {
    const quickness = getFirstNumber(sheet, [
      ["quickness"],
      ["traits", "quickness"],
      ["attributes", "quickness"],
    ]);
    if (quickness !== null) {
      // Deadlands quickness is modeled as trait steps (typically 1-5 in this app).
      // Return the trait step so initiative card draws can be derived from it.
      return clampInteger(quickness, 1, 5);
    }
    return context.rosterType === "enemy" ? 2 : 3;
  }

  return context.rosterType === "enemy" ? 0 : 1;
}

export function getAttackDefaults(context: AttackDefaultsContext): AttackDefaults {
  const actorSheet = context.actorCharacter?.sheetJson;
  const targetSheet = context.targetCharacter?.sheetJson;
  const actorRuntime = context.actorRuntime ?? null;
  const targetRuntime = context.targetRuntime ?? null;
  const actorLevel = getCharacterLevel(actorSheet);
  const targetLevel = getCharacterLevel(targetSheet);

  if (isDndRuleset(context.ruleset)) {
    const attackBonus =
      parseFiniteNumber(actorRuntime?.attackBonusOverride) ??
      getFirstNumber(actorSheet, [
        ["attackBonus"],
        ["attacks", "melee", "toHit"],
        ["attacks", "spell", "toHit"],
        ["proficiencyBonus"],
      ]);
    const targetAc =
      parseFiniteNumber(targetRuntime?.armorClass) ??
      getFirstNumber(targetSheet, [
        ["ac"],
        ["armorClass"],
        ["defense", "ac"],
      ]);
    const damageDie =
      parseFiniteNumber(actorRuntime?.damageDieOverride) ??
      getFirstNumber(actorSheet, [
        ["damageDie"],
        ["attacks", "melee", "damageDie"],
        ["weapon", "damageDie"],
      ]);
    const damageBonus =
      parseFiniteNumber(actorRuntime?.damageBonusOverride) ??
      getFirstNumber(actorSheet, [
        ["damageBonus"],
        ["attacks", "melee", "damageBonus"],
        ["abilities", "str", "modifier"],
        ["spellcasting", "modifier"],
      ]);

    const inferredEnemyAttackBonus =
      targetLevel <= 2 ? 2 : targetLevel <= 5 ? 3 : targetLevel <= 10 ? 4 : 5;
    const inferredEnemyDamageDie =
      targetLevel <= 2 ? 4 : targetLevel <= 5 ? 6 : targetLevel <= 10 ? 8 : 10;
    const inferredEnemyDamageBonus =
      targetLevel <= 2 ? 0 : targetLevel <= 5 ? 1 : targetLevel <= 10 ? 2 : 3;

    const inferredPlayerAttackBonus =
      actorLevel <= 2 ? 5 : actorLevel <= 4 ? 6 : actorLevel <= 8 ? 7 : 8;
    const inferredPlayerDamageDie =
      actorLevel <= 2 ? 8 : actorLevel <= 4 ? 8 : actorLevel <= 10 ? 10 : 12;
    const inferredPlayerDamageBonus =
      actorLevel <= 2 ? 3 : actorLevel <= 4 ? 4 : actorLevel <= 10 ? 5 : 6;
    const inferredNpcAttackBonus =
      actorLevel <= 2 ? 2 : actorLevel <= 5 ? 3 : actorLevel <= 10 ? 4 : 5;
    const inferredNpcDamageDie =
      actorLevel <= 2 ? 4 : actorLevel <= 5 ? 6 : actorLevel <= 10 ? 8 : 10;
    const inferredNpcDamageBonus =
      actorLevel <= 2 ? 0 : actorLevel <= 5 ? 1 : actorLevel <= 10 ? 2 : 3;

    return {
      attackDie: 20,
      attackBonus: clampInteger(
        attackBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyAttackBonus
            : context.actorType === "npc"
              ? inferredNpcAttackBonus
              : inferredPlayerAttackBonus),
        -5,
        20,
      ),
      targetAc: clampInteger(targetAc ?? (context.targetCharacter ? 13 : 12), 8, 30),
      damageDie: clampInteger(
        damageDie ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageDie
            : context.actorType === "npc"
              ? inferredNpcDamageDie
              : inferredPlayerDamageDie),
        4,
        20,
      ),
      damageBonus: clampInteger(
        damageBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageBonus
            : context.actorType === "npc"
              ? inferredNpcDamageBonus
              : inferredPlayerDamageBonus),
        -2,
        15,
      ),
    };
  }

  if (isDeadlandsRuleset(context.ruleset)) {
    const fightingBonus = getFirstNumber(actorSheet, [
      ["fightingModifier"],
      ["combat", "fighting", "modifier"],
      ["fighting"],
      ["traits", "deftness"],
    ]);
    const fightingDie = getFirstNumber(actorSheet, [
      ["fightingDie"],
      ["combat", "fighting", "die"],
      ["traits", "fighting", "die"],
      ["traits", "deftness", "die"],
    ]);
    const targetTn =
      parseFiniteNumber(targetRuntime?.armorClass) ??
      getFirstNumber(targetSheet, [
        ["targetNumber"],
        ["tn"],
        ["defense", "tn"],
        ["parry"],
      ]);
    const weaponProfile = getDeadlandsWeaponProfile(actorSheet);
    const weaponName = weaponProfile?.weaponName ?? "";
    const isRangedWeapon = /(revolver|peacemaker|schofield|pistol|rifle|repeater|longarm|shotgun|bow|crossbow)/i.test(
      weaponName,
    );
    const skillTerms = isRangedWeapon
      ? ["shootin", "shooting", "firearm", "pistol", "rifle"]
      : ["fightin", "fighting", "brawlin", "brawling", "knife", "saber"];
    const skillMatchScore = scoreDeadlandsSkillMatch(actorSheet, skillTerms);
    const deftnessTrait = getFirstNumber(actorSheet, [
      ["traits", "deftness"],
      ["deftness"],
    ]);
    const baseSkillDie = deadlandsTraitToDieSides(deftnessTrait);
    const explicitSkillDie = getDeadlandsStoredSkillDie(
      actorSheet,
      isRangedWeapon
        ? ["shootin", "shooting", "hexslingin", "faith", "mad_science"]
        : ["fightin", "fighting", "brawlin", "brawling"],
    );
    const derivedSkillDie =
      skillMatchScore >= 2 ? baseSkillDie + 2 : skillMatchScore >= 1 ? baseSkillDie : baseSkillDie - 2;
    const damageDie =
      parseFiniteNumber(actorRuntime?.damageDieOverride) ??
      getFirstNumber(actorSheet, [
        ["damageDie"],
        ["weapon", "damageDie"],
        ["damage", "die"],
      ]);
    const damageBonus =
      parseFiniteNumber(actorRuntime?.damageBonusOverride) ??
      getFirstNumber(actorSheet, [
        ["damageBonus"],
        ["strength", "modifier"],
        ["damage", "bonus"],
      ]);

    const inferredEnemyAttackBonus =
      targetLevel <= 2 ? 0 : targetLevel <= 5 ? 1 : targetLevel <= 10 ? 2 : 3;
    const inferredEnemyDamageDie =
      targetLevel <= 2 ? 4 : targetLevel <= 5 ? 6 : targetLevel <= 10 ? 8 : 10;
    const inferredEnemyDamageBonus =
      targetLevel <= 5 ? 0 : targetLevel <= 10 ? 1 : 2;

    const inferredPlayerAttackBonus =
      actorLevel <= 2 ? 2 : actorLevel <= 5 ? 3 : actorLevel <= 10 ? 4 : 5;
    const inferredPlayerDamageDie =
      actorLevel <= 2 ? 6 : actorLevel <= 5 ? 8 : actorLevel <= 10 ? 10 : 12;
    const inferredPlayerDamageBonus =
      actorLevel <= 2 ? 1 : actorLevel <= 10 ? 2 : 3;
    const inferredNpcAttackBonus =
      actorLevel <= 2 ? 1 : actorLevel <= 5 ? 2 : actorLevel <= 10 ? 3 : 4;
    const inferredNpcDamageDie =
      actorLevel <= 2 ? 6 : actorLevel <= 5 ? 8 : actorLevel <= 10 ? 10 : 12;
    const inferredNpcDamageBonus =
      actorLevel <= 2 ? 0 : actorLevel <= 10 ? 1 : 2;

    return {
      attackDie: clampInteger(explicitSkillDie ?? fightingDie ?? derivedSkillDie, 4, 20),
      attackBonus: clampInteger(
        weaponProfile?.attackBonus ??
          parseFiniteNumber(actorRuntime?.attackBonusOverride) ??
          fightingBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyAttackBonus
            : context.actorType === "npc"
              ? inferredNpcAttackBonus
              : inferredPlayerAttackBonus),
        -5,
        15,
      ),
      targetAc: clampInteger(targetTn ?? 5, 2, 20),
      damageDie: clampInteger(
        damageDie ??
          weaponProfile?.damageDie ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageDie
            : context.actorType === "npc"
              ? inferredNpcDamageDie
              : inferredPlayerDamageDie),
        4,
        20,
      ),
      damageBonus: clampInteger(
        damageBonus ??
          weaponProfile?.damageBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageBonus
            : context.actorType === "npc"
              ? inferredNpcDamageBonus
              : inferredPlayerDamageBonus),
        -2,
        20,
      ),
    };
  }

  if (isSavageRiftsRuleset(context.ruleset)) {
    const attackBonus =
      parseFiniteNumber(actorRuntime?.attackBonusOverride) ??
      getFirstNumber(actorSheet, [
        ["attackBonus"],
        ["attacks", "melee", "toHit"],
        ["attacks", "ranged", "toHit"],
        ["proficiencyBonus"],
      ]);
    const targetAc =
      parseFiniteNumber(targetRuntime?.armorClass) ??
      getFirstNumber(targetSheet, [
        ["ac"],
        ["armorClass"],
        ["defense", "ac"],
        ["mdc"],
      ]);
    const damageDie =
      parseFiniteNumber(actorRuntime?.damageDieOverride) ??
      getFirstNumber(actorSheet, [
        ["damageDie"],
        ["attacks", "melee", "damageDie"],
        ["weapon", "damageDie"],
      ]);
    const damageBonus =
      parseFiniteNumber(actorRuntime?.damageBonusOverride) ??
      getFirstNumber(actorSheet, [
        ["damageBonus"],
        ["attacks", "melee", "damageBonus"],
        ["abilities", "str", "modifier"],
      ]);

    const inferredEnemyAttackBonus =
      targetLevel <= 2 ? 2 : targetLevel <= 5 ? 3 : targetLevel <= 10 ? 4 : 5;
    const inferredEnemyDamageDie =
      targetLevel <= 2 ? 6 : targetLevel <= 5 ? 8 : targetLevel <= 10 ? 10 : 12;
    const inferredEnemyDamageBonus =
      targetLevel <= 2 ? 0 : targetLevel <= 5 ? 1 : targetLevel <= 10 ? 2 : 3;

    const inferredPlayerAttackBonus =
      actorLevel <= 2 ? 5 : actorLevel <= 5 ? 6 : actorLevel <= 10 ? 7 : 8;
    const inferredPlayerDamageDie =
      actorLevel <= 2 ? 8 : actorLevel <= 5 ? 10 : actorLevel <= 10 ? 12 : 12;
    const inferredPlayerDamageBonus =
      actorLevel <= 2 ? 2 : actorLevel <= 5 ? 3 : actorLevel <= 10 ? 4 : 5;
    const inferredNpcAttackBonus =
      actorLevel <= 2 ? 3 : actorLevel <= 5 ? 4 : actorLevel <= 10 ? 5 : 6;
    const inferredNpcDamageDie =
      actorLevel <= 2 ? 6 : actorLevel <= 5 ? 8 : actorLevel <= 10 ? 10 : 12;
    const inferredNpcDamageBonus =
      actorLevel <= 2 ? 1 : actorLevel <= 5 ? 2 : actorLevel <= 10 ? 3 : 4;

    return {
      attackDie: 20,
      attackBonus: clampInteger(
        attackBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyAttackBonus
            : context.actorType === "npc"
              ? inferredNpcAttackBonus
              : inferredPlayerAttackBonus),
        -5,
        25,
      ),
      targetAc: clampInteger(targetAc ?? (context.targetCharacter ? 14 : 13), 8, 35),
      damageDie: clampInteger(
        damageDie ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageDie
            : context.actorType === "npc"
              ? inferredNpcDamageDie
              : inferredPlayerDamageDie),
        4,
        20,
      ),
      damageBonus: clampInteger(
        damageBonus ??
          (context.actorType === "enemy"
            ? inferredEnemyDamageBonus
            : context.actorType === "npc"
              ? inferredNpcDamageBonus
              : inferredPlayerDamageBonus),
        -2,
        20,
      ),
    };
  }

  return {
    attackDie: 20,
    attackBonus: context.actorType === "enemy" ? 1 : 2,
    targetAc: 10,
    damageDie: 8,
    damageBonus: context.actorType === "enemy" ? 0 : 1,
  };
}
