type CatalogProfile = "dnd" | "deadlands" | "generic";
type CatalogDelivery = "attack" | "save" | "auto-hit";
type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";

type CatalogSaveSpec = {
  ability: SaveAbility;
  dc?: number;
  onSave: "none" | "half";
};

type CatalogConcentrationSpec = {
  required: true;
  durationRounds: number;
  breakOnDamage?: boolean;
};

type CatalogAdvantageHooks = {
  targetGrantsAdvantageToAttackers?: boolean;
  actorGainsAdvantageOnNextAttack?: boolean;
};

type CatalogReactionHooks = {
  trigger: string;
  note: string;
};

type CatalogCostSpec = {
  consumesSpellSlot?: boolean;
  cantripScaling?: "dnd";
};

type CatalogStatusDurationSpec = {
  effect: string;
  durationRounds: number;
  kind?: "timed" | "concentration";
  breakOnDamage?: boolean;
};

export type CatalogEffectResolution = {
  id: string;
  name: string;
  delivery: CatalogDelivery;
  attackDieOverride?: number;
  attackBonusModifier?: number;
  damageDieOverride?: number;
  damageDiceCountOverride?: number;
  damageBonusModifier?: number;
  save?: CatalogSaveSpec;
  concentration?: CatalogConcentrationSpec;
  advantageHooks?: CatalogAdvantageHooks;
  reactionHooks?: CatalogReactionHooks[];
  cost?: CatalogCostSpec;
  onHitTargetStatusEffects: string[];
  onFailedSaveTargetStatusEffects: string[];
  onHitTargetStatusDurations?: CatalogStatusDurationSpec[];
  onFailedSaveTargetStatusDurations?: CatalogStatusDurationSpec[];
};

function normalizeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

type CatalogEntry = {
  id: string;
  name: string;
  aliases: string[];
  profile: CatalogProfile;
  apply: () => Omit<CatalogEffectResolution, "id" | "name">;
};

const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    id: "dnd_ray_of_frost",
    name: "Ray of Frost",
    aliases: ["ray of frost"],
    profile: "dnd",
    apply: () => ({
      delivery: "attack",
      damageDieOverride: 8,
      damageBonusModifier: 0,
      cost: {
        consumesSpellSlot: false,
        cantripScaling: "dnd",
      },
      onHitTargetStatusEffects: ["Slowed"],
      onFailedSaveTargetStatusEffects: [],
      onHitTargetStatusDurations: [
        {
          effect: "Slowed",
          durationRounds: 1,
          kind: "timed",
        },
      ],
    }),
  },
  {
    id: "dnd_chill_touch",
    name: "Chill Touch",
    aliases: ["chill touch"],
    profile: "dnd",
    apply: () => ({
      delivery: "attack",
      damageDieOverride: 8,
      damageBonusModifier: 0,
      cost: {
        consumesSpellSlot: false,
        cantripScaling: "dnd",
      },
      onHitTargetStatusEffects: ["No Healing"],
      onFailedSaveTargetStatusEffects: [],
      onHitTargetStatusDurations: [
        {
          effect: "No Healing",
          durationRounds: 1,
          kind: "timed",
        },
      ],
    }),
  },
  {
    id: "dnd_fire_bolt",
    name: "Fire Bolt",
    aliases: ["fire bolt"],
    profile: "dnd",
    apply: () => ({
      delivery: "attack",
      damageDieOverride: 10,
      damageBonusModifier: 0,
      cost: {
        consumesSpellSlot: false,
        cantripScaling: "dnd",
      },
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: [],
    }),
  },
  {
    id: "dnd_guiding_bolt",
    name: "Guiding Bolt",
    aliases: ["guiding bolt"],
    profile: "dnd",
    apply: () => ({
      delivery: "attack",
      damageDieOverride: 6,
      damageBonusModifier: 10,
      onHitTargetStatusEffects: ["Illuminated"],
      onFailedSaveTargetStatusEffects: [],
      onHitTargetStatusDurations: [
        {
          effect: "Illuminated",
          durationRounds: 1,
          kind: "timed",
        },
      ],
      advantageHooks: {
        targetGrantsAdvantageToAttackers: true,
      },
    }),
  },
  {
    id: "dnd_hold_person",
    name: "Hold Person",
    aliases: ["hold person"],
    profile: "dnd",
    apply: () => ({
      delivery: "save",
      save: {
        ability: "wis",
        dc: 13,
        onSave: "none",
      },
      concentration: {
        required: true,
        durationRounds: 10,
        breakOnDamage: true,
      },
      damageDieOverride: 4,
      damageBonusModifier: 0,
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: ["Restrained"],
      onFailedSaveTargetStatusDurations: [
        {
          effect: "Restrained",
          durationRounds: 10,
          kind: "timed",
          breakOnDamage: true,
        },
      ],
    }),
  },
  {
    id: "dnd_sacred_flame",
    name: "Sacred Flame",
    aliases: ["sacred flame"],
    profile: "dnd",
    apply: () => ({
      delivery: "save",
      save: {
        ability: "dex",
        dc: 13,
        onSave: "none",
      },
      damageDieOverride: 8,
      damageDiceCountOverride: 1,
      damageBonusModifier: 0,
      cost: {
        consumesSpellSlot: false,
        cantripScaling: "dnd",
      },
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: [],
    }),
  },
  {
    id: "dnd_fireball",
    name: "Fireball",
    aliases: ["fireball"],
    profile: "dnd",
    apply: () => ({
      delivery: "save",
      save: {
        ability: "dex",
        dc: 13,
        onSave: "half",
      },
      damageDieOverride: 6,
      damageDiceCountOverride: 8,
      damageBonusModifier: 0,
      cost: {
        consumesSpellSlot: true,
      },
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: [],
    }),
  },
  {
    id: "dnd_magic_missile",
    name: "Magic Missile",
    aliases: ["magic missile"],
    profile: "dnd",
    apply: () => ({
      delivery: "auto-hit",
      damageDieOverride: 4,
      damageDiceCountOverride: 3,
      damageBonusModifier: 1,
      cost: {
        consumesSpellSlot: true,
      },
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: [],
    }),
  },
  {
    id: "dnd_shield",
    name: "Shield",
    aliases: ["shield"],
    profile: "dnd",
    apply: () => ({
      delivery: "attack",
      damageDieOverride: 4,
      damageBonusModifier: 0,
      onHitTargetStatusEffects: [],
      onFailedSaveTargetStatusEffects: [],
      reactionHooks: [
        {
          trigger: "when_hit_by_attack",
          note: "Can use reaction to raise AC by +5 until start of next turn.",
        },
      ],
    }),
  },
];

export function resolveCatalogEffect(params: {
  profile: CatalogProfile;
  kind: "attack" | "cast-spell";
  spellName?: string;
}) {
  if (params.kind !== "cast-spell" || !params.spellName) {
    return null;
  }

  const normalizedName = normalizeLookup(params.spellName);
  if (!normalizedName) {
    return null;
  }

  const entry = CATALOG_ENTRIES.find(
    (candidate) =>
      candidate.profile === params.profile &&
      candidate.aliases.some((alias) => normalizeLookup(alias) === normalizedName),
  );

  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    name: entry.name,
    ...entry.apply(),
  } satisfies CatalogEffectResolution;
}

export function getCatalogSpellPreview(params: {
  profile: CatalogProfile;
  spellName: string;
}) {
  return resolveCatalogEffect({
    profile: params.profile,
    kind: "cast-spell",
    spellName: params.spellName,
  });
}
