"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  getCharacterQuestionnaire,
  getVisibleCharacterQuestions,
  sanitizeCharacterAnswersForLimits,
  validateCharacterAnswersDetailed,
  type CharacterQuestion,
} from "@/lib/campaigns";
import { normalizeCoachApiResponse } from "@/lib/character-coach";
import {
  CHARACTER_BUILDER_STEPS,
  getBuilderStepLabel,
  partitionCharacterQuestions,
  type CharacterBuilderStep,
} from "@/lib/character-builder";
import {
  DND_ABILITY_IDS,
  DND_STANDARD_ARRAY,
  DND_POINT_BUY_COST_BY_SCORE,
  applyRecommendedStandardArrayForClass,
  canAssignStandardArrayValue,
  canIncreasePointBuyScore,
  getDndAsiBonuses,
  getDndPointBuySpent,
  isStandardArrayMatch,
  rollAbilityScoresFromSeed,
} from "@/lib/dnd-ability-builder";
import { appendQueryParamsToPath } from "@/lib/navigation";

const DEFAULT_PORTRAIT_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'>" +
      "<rect width='256' height='256' fill='#18181b'/>" +
      "<circle cx='128' cy='92' r='42' fill='#3f3f46'/>" +
      "<path d='M52 224c10-46 44-74 76-74s66 28 76 74' fill='#3f3f46'/>" +
      "<circle cx='128' cy='128' r='92' fill='none' stroke='#52525b' stroke-width='6'/>" +
    "</svg>",
  );

const EMPTY_ANSWERS: Record<string, string | number> = {};

type LibraryCharacterBuilderProps = {
  mode: "create" | "edit";
  initialRuleset: string;
  rulesetOptions?: readonly string[];
  rulesetLocked?: boolean;
  initialName?: string;
  initialAnswers?: Record<string, string | number>;
  submitUrl: string;
  submitMethod: "POST" | "PATCH";
  returnTo: string;
  backHref: string;
  backLabel: string;
  headingKicker: string;
  headingTitle: string;
  headingDescription: string;
  headingFacts?: Array<{ label: string; value: string }>;
  submitBodyBuilder?: (params: {
    mode: "create" | "edit";
    selectedRuleset: string;
    characterName: string;
    answers: Record<string, string | number>;
  }) => Record<string, unknown>;
  onSubmitSuccess?: (params: {
    character: Record<string, unknown>;
    rawResponse: Record<string, unknown>;
  }) => void | Promise<void>;
  redirectOnSuccess?: boolean;
  showBackLink?: boolean;
  submitLabelCreate?: string;
  submitLabelEdit?: string;
  submitLabelSavingCreate?: string;
  submitLabelSavingEdit?: string;
  embedded?: boolean;
  showHeading?: boolean;
  showInlineHeaderWhenNoHero?: boolean;
};

type CoachChatMessage = {
  role: "user" | "assistant";
  content: string;
  warning?: string;
  suggestions?: {
    name?: string;
    personality?: string;
    background?: string;
    physicalDescription?: string;
  };
  options?: {
    nameOptions?: string[];
    personalityOptions?: string[];
    backgroundOptions?: string[];
    physicalDescriptionOptions?: string[];
  };
};

type CoachFieldId = "name" | "personality" | "background" | "physicalDescription";
type CoachTargetMode = "auto" | CoachFieldId;
type StatsSubpanel = "core" | "abilities" | "traits" | "skills" | "resources";

function isCoachLockableField(fieldId: string) {
  return (
    fieldId === "personality" ||
    fieldId === "background" ||
    fieldId === "physicalDescription"
  );
}

function getDndAbilityModifier(score: number) {
  return Math.floor((score - 10) / 2);
}

const DEADLANDS_TRAIT_IDS = [
  "deftness",
  "nimbleness",
  "quickness",
  "strength",
  "vigor",
  "cognition",
  "knowledge",
  "mien",
  "smarts",
  "spirit",
] as const;

const DEADLANDS_SKILL_POINT_COST_BY_DIE: Record<number, number> = {
  4: 1,
  6: 2,
  8: 3,
  10: 4,
  12: 5,
};

const DND_ABILITY_LABEL_ABBREVIATIONS: Record<string, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

function toRulesetStorageKey(ruleset: string) {
  return ruleset.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default";
}

export function LibraryCharacterBuilder({
  mode,
  initialRuleset,
  rulesetOptions = [],
  rulesetLocked = false,
  initialName = "",
  initialAnswers,
  submitUrl,
  submitMethod,
  returnTo,
  backHref,
  backLabel,
  headingKicker,
  headingTitle,
  headingDescription,
  headingFacts = [],
  submitBodyBuilder,
  onSubmitSuccess,
  redirectOnSuccess = true,
  showBackLink = true,
  submitLabelCreate = "Save Character",
  submitLabelEdit = "Save Character",
  submitLabelSavingCreate = "Saving character...",
  submitLabelSavingEdit = "Saving changes...",
  embedded = false,
  showHeading = true,
  showInlineHeaderWhenNoHero = false,
}: LibraryCharacterBuilderProps) {
  const router = useRouter();
  const [selectedRuleset, setSelectedRuleset] = useState(initialRuleset);
  const [characterName, setCharacterName] = useState(initialName);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [activeStep, setActiveStep] = useState<CharacterBuilderStep>("identity");
  const [activeStatsSubpanel, setActiveStatsSubpanel] = useState<StatsSubpanel>("core");
  const [dndOverridesCollapsed, setDndOverridesCollapsed] = useState(true);
  const [reviewSummaryCollapsed, setReviewSummaryCollapsed] = useState(true);
  const [collapsedSectionMap, setCollapsedSectionMap] = useState<Record<string, boolean>>({});
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [expandedPreviewImage, setExpandedPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [isSendingCoachMessage, setIsSendingCoachMessage] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [coachApplyNotice, setCoachApplyNotice] = useState("");
  const [coachApplyMode, setCoachApplyMode] = useState<"replace" | "append">("replace");
  const [coachTargetMode, setCoachTargetMode] = useState<CoachTargetMode>("auto");
  const [coachQuickAction, setCoachQuickAction] = useState("");
  const [coachFieldBadges, setCoachFieldBadges] = useState<Record<string, string>>({});
  const [coachLastAppliedByField, setCoachLastAppliedByField] = useState<
    Partial<Record<CoachFieldId, { previous: string | number | undefined }>>
  >({});
  const [coachMessages, setCoachMessages] = useState<CoachChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask for character ideas, tone, or writing help. Use the action buttons to copy suggestions into form fields.",
    },
  ]);
  const [error, setError] = useState("");
  const [hasRestorableDraft, setHasRestorableDraft] = useState(false);
  const [abilityGenerationNotice, setAbilityGenerationNotice] = useState("");
  const [expandedCoachOptionKeys, setExpandedCoachOptionKeys] = useState<Record<string, boolean>>(
    {},
  );
  const coachScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const initialAnswerValues = useMemo(
    () => sanitizeCharacterAnswersForLimits(initialAnswers ?? EMPTY_ANSWERS),
    [initialAnswers],
  );

  const questions = useMemo(
    () => getCharacterQuestionnaire(selectedRuleset),
    [selectedRuleset],
  );
  const visibleQuestions = useMemo(
    () => getVisibleCharacterQuestions(selectedRuleset, answers),
    [answers, selectedRuleset],
  );
  const liveValidation = useMemo(
    () => validateCharacterAnswersDetailed(selectedRuleset, answers),
    [answers, selectedRuleset],
  );
  const liveValidationError = liveValidation.formError;
  const liveFieldErrors = liveValidation.fieldErrors;

  useEffect(() => {
    setSelectedRuleset(initialRuleset);
    setCharacterName(initialName);
    setAnswers({
      ...buildDefaultAnswers(getCharacterQuestionnaire(initialRuleset)),
      ...initialAnswerValues,
    });
    setLockedFields({});
  }, [initialAnswerValues, initialName, initialRuleset]);

  useEffect(() => {
    if (rulesetLocked) {
      return;
    }

    const defaultAnswers = buildDefaultAnswers(questions);
    if (mode !== "create") {
      setAnswers(defaultAnswers);
      return;
    }
    const draftKey = getCharacterBuilderDraftKey(selectedRuleset);
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (!stored) {
        setAnswers(defaultAnswers);
        return;
      }
      const parsed = JSON.parse(stored) as {
        characterName?: unknown;
        answers?: unknown;
      };
      if (typeof parsed.characterName === "string" && parsed.characterName.trim()) {
        setCharacterName(parsed.characterName);
      }
      const draftAnswers =
        parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
          ? (parsed.answers as Record<string, string | number>)
          : {};
      setAnswers({
        ...defaultAnswers,
        ...draftAnswers,
      });
    } catch {
      setAnswers(defaultAnswers);
    }
    setLockedFields({});
  }, [mode, questions, rulesetLocked, selectedRuleset]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    try {
      const draftKey = getCharacterBuilderDraftKey(selectedRuleset);
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          characterName,
          answers,
        }),
      );
      setHasRestorableDraft(Boolean(window.localStorage.getItem(getCharacterBuilderClearedDraftKey(selectedRuleset))));
    } catch {
      // Ignore local storage failures in private/incognito contexts.
    }
  }, [answers, characterName, mode, selectedRuleset]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    try {
      setHasRestorableDraft(
        Boolean(window.localStorage.getItem(getCharacterBuilderClearedDraftKey(selectedRuleset))),
      );
    } catch {
      setHasRestorableDraft(false);
    }
  }, [mode, selectedRuleset]);

  useEffect(() => {
    if (activeStep !== "stats") {
      return;
    }
    const rulesetStorageKey = toRulesetStorageKey(selectedRuleset);
    let hydratedSubpanel: StatsSubpanel | null = null;

    try {
      const storedSubpanel = window.localStorage.getItem(
        `character-builder:stats-subpanel:${rulesetStorageKey}`,
      );
      if (
        storedSubpanel === "core" ||
        storedSubpanel === "abilities" ||
        storedSubpanel === "traits" ||
        storedSubpanel === "skills" ||
        storedSubpanel === "resources"
      ) {
        hydratedSubpanel = storedSubpanel;
      }
    } catch {
      // Ignore localStorage access failures.
    }

    setActiveStatsSubpanel(
      hydratedSubpanel ??
        (selectedRuleset.trim().toLowerCase() === "d&d 5e"
          ? "abilities"
          : selectedRuleset.trim().toLowerCase() === "deadlands classic"
            ? "traits"
            : "core"),
    );
  }, [activeStep, selectedRuleset]);

  useEffect(() => {
    if (activeStep !== "stats") {
      return;
    }
    try {
      const rulesetStorageKey = toRulesetStorageKey(selectedRuleset);
      window.localStorage.setItem(
        `character-builder:stats-subpanel:${rulesetStorageKey}`,
        activeStatsSubpanel,
      );
    } catch {
      // Ignore localStorage access failures.
    }
  }, [activeStatsSubpanel, activeStep, selectedRuleset]);

  useEffect(() => {
    if (selectedRuleset.trim().toLowerCase() !== "d&d 5e") {
      return;
    }
    setDndOverridesCollapsed(true);
  }, [selectedRuleset]);

  const portraitDataUrl =
    typeof answers.portraitDataUrl === "string" &&
    answers.portraitDataUrl.startsWith("data:image/")
      ? answers.portraitDataUrl
      : "";
  const tokenDataUrl =
    typeof answers.tokenDataUrl === "string" &&
    answers.tokenDataUrl.startsWith("data:image/")
      ? answers.tokenDataUrl
      : "";
  const partitionedQuestions = useMemo(
    () => partitionCharacterQuestions(visibleQuestions),
    [visibleQuestions],
  );
  const identityQuestions = partitionedQuestions.identityQuestions;
  const descriptionQuestions = partitionedQuestions.descriptionQuestions;
  const statsQuestions = partitionedQuestions.mechanicsStatsQuestions;
  const spellQuestions = partitionedQuestions.mechanicsSpellQuestions;
  const equipmentQuestions = partitionedQuestions.mechanicsEquipmentQuestions;
  const identityQuestionsForRender = useMemo(
    () => {
      if (selectedRuleset.trim().toLowerCase() !== "d&d 5e") {
        return identityQuestions;
      }

      const baseIdentityQuestions = identityQuestions.filter(
        (question) => question.id !== "abilityGenerationMethod",
      );
      const levelQuestion = statsQuestions.find((question) => question.id === "level");

      if (!levelQuestion || baseIdentityQuestions.some((question) => question.id === "level")) {
        return baseIdentityQuestions;
      }

      const classIndex = baseIdentityQuestions.findIndex((question) => question.id === "class");
      if (classIndex >= 0) {
        return [
          ...baseIdentityQuestions.slice(0, classIndex + 1),
          levelQuestion,
          ...baseIdentityQuestions.slice(classIndex + 1),
        ];
      }

      return [levelQuestion, ...baseIdentityQuestions];
    },
    [identityQuestions, selectedRuleset, statsQuestions],
  );
  const isDnd5eRuleset = selectedRuleset.trim().toLowerCase() === "d&d 5e";
  const isDeadlandsRuleset = selectedRuleset.trim().toLowerCase() === "deadlands classic";
  const dndAbilityGenerationMethod =
    typeof answers.abilityGenerationMethod === "string"
      ? answers.abilityGenerationMethod
      : "manual-enter";
  const dndAbilityScoreRuleSet =
    typeof answers.abilityScoreRuleSet === "string"
      ? answers.abilityScoreRuleSet
      : "legacy-fixed";
  const dndAsiPlusTwo =
    typeof answers.asiPlusTwo === "string" ? answers.asiPlusTwo : "str";
  const dndAsiPlusOne =
    typeof answers.asiPlusOne === "string" ? answers.asiPlusOne : "con";
  const dndAncestry =
    typeof answers.ancestry === "string" ? answers.ancestry : "Human";
  const dndAbilityScores = useMemo(
    () =>
      Object.fromEntries(
        DND_ABILITY_IDS.map((abilityId) => {
          const rawValue = answers[abilityId];
          const value =
            typeof rawValue === "number"
              ? rawValue
              : typeof rawValue === "string" && rawValue.trim()
                ? Number(rawValue)
                : 10;
          return [abilityId, Number.isFinite(value) ? value : 10];
        }),
      ) as Record<(typeof DND_ABILITY_IDS)[number], number>,
    [answers],
  );
  const dndAbilityScoreValues = DND_ABILITY_IDS.map((abilityId) => dndAbilityScores[abilityId]);
  const dndAbilityBonuses = getDndAsiBonuses({
    ancestry: dndAncestry,
    abilityScoreRuleSet: dndAbilityScoreRuleSet,
    asiPlusTwo: dndAsiPlusTwo,
    asiPlusOne: dndAsiPlusOne,
  });
  const dndFinalAbilityScores = Object.fromEntries(
    DND_ABILITY_IDS.map((abilityId) => [
      abilityId,
      Math.min(20, dndAbilityScores[abilityId] + dndAbilityBonuses[abilityId]),
    ]),
  ) as Record<(typeof DND_ABILITY_IDS)[number], number>;
  const dndAbilityScoreQuestions = useMemo(
    () => statsQuestions.filter((question) => DND_ABILITY_IDS.includes(question.id as (typeof DND_ABILITY_IDS)[number])),
    [statsQuestions],
  );
  const dndAbilityScoreQuestionById = useMemo(
    () =>
      Object.fromEntries(
        dndAbilityScoreQuestions.map((question) => [question.id, question]),
      ) as Partial<Record<(typeof DND_ABILITY_IDS)[number], CharacterQuestion>>,
    [dndAbilityScoreQuestions],
  );
  const dndAbilityGenerationQuestion = useMemo(
    () => statsQuestions.find((question) => question.id === "abilityGenerationMethod"),
    [statsQuestions],
  );
  const nonAbilityStatsQuestions = useMemo(
    () => statsQuestions.filter((question) => !DND_ABILITY_IDS.includes(question.id as (typeof DND_ABILITY_IDS)[number])),
    [statsQuestions],
  );
  const nonAbilityStatsQuestionsForDnd = useMemo(
    () => nonAbilityStatsQuestions.filter((question) => question.id !== "abilityGenerationMethod"),
    [nonAbilityStatsQuestions],
  );
  const deadlandsTraitQuestionIds = useMemo(
    () =>
      new Set<string>([
        "traitGenerationMethod",
        "traitPointBudget",
        ...DEADLANDS_TRAIT_IDS,
      ]),
    [],
  );
  const deadlandsSkillQuestionIds = useMemo(
    () =>
      new Set<string>([
        "primarySkill",
        "secondarySkill",
        "primarySkillDie",
        "secondarySkillDie",
        "skillBaseDie",
        "skillPointBudget",
        "guts",
      ]),
    [],
  );
  const deadlandsResourceQuestionIds = useMemo(
    () =>
      new Set<string>([
        "woundHead",
        "woundGuts",
        "woundLeftArm",
        "woundRightArm",
        "woundLeftLeg",
        "woundRightLeg",
        "fateWhite",
        "fateRed",
        "fateBlue",
        "fateLegend",
        "woundIgnore",
        "overridePaceEnabled",
        "overridePace",
        "overrideWindEnabled",
        "overrideWind",
        "overrideGritEnabled",
        "overrideGrit",
      ]),
    [],
  );
  const deadlandsCoreStatsQuestions = useMemo(
    () =>
      statsQuestions.filter(
        (question) =>
          !deadlandsTraitQuestionIds.has(question.id) &&
          !deadlandsSkillQuestionIds.has(question.id) &&
          !deadlandsResourceQuestionIds.has(question.id),
      ),
    [
      deadlandsResourceQuestionIds,
      deadlandsSkillQuestionIds,
      deadlandsTraitQuestionIds,
      statsQuestions,
    ],
  );
  const deadlandsTraitStatsQuestions = useMemo(
    () => statsQuestions.filter((question) => deadlandsTraitQuestionIds.has(question.id)),
    [deadlandsTraitQuestionIds, statsQuestions],
  );
  const deadlandsSkillStatsQuestions = useMemo(
    () => statsQuestions.filter((question) => deadlandsSkillQuestionIds.has(question.id)),
    [deadlandsSkillQuestionIds, statsQuestions],
  );
  const deadlandsResourceStatsQuestions = useMemo(
    () => statsQuestions.filter((question) => deadlandsResourceQuestionIds.has(question.id)),
    [deadlandsResourceQuestionIds, statsQuestions],
  );
  const dndCoreStatsQuestions = useMemo(
    () =>
      nonAbilityStatsQuestionsForDnd.filter(
        (question) =>
          question.id !== "level" &&
          !question.id.startsWith("override") &&
          !["abilityScoreRuleSet", "asiPlusTwo", "asiPlusOne", "abilityRollSeed"].includes(
            question.id,
          ),
      ),
    [nonAbilityStatsQuestionsForDnd],
  );
  const dndAbilityConfigQuestions = useMemo(
    () =>
      nonAbilityStatsQuestionsForDnd.filter((question) =>
        [
          "abilityGenerationMethod",
          "abilityScoreRuleSet",
          "asiPlusTwo",
          "asiPlusOne",
          "abilityRollSeed",
        ].includes(question.id),
      ),
    [nonAbilityStatsQuestionsForDnd],
  );
  const dndPointBuySpent = getDndPointBuySpent(dndAbilityScoreValues);
  const dndPointBuyRemaining = 27 - dndPointBuySpent;
  const dndPointBuyOutOfRangeIds = DND_ABILITY_IDS.filter((abilityId) => {
    const score = dndAbilityScores[abilityId];
    return score < 8 || score > 15;
  });
  const dndStandardArrayMatches = isStandardArrayMatch(dndAbilityScoreValues);
  const dndAbilityRollSeed =
    typeof answers.abilityRollSeed === "string" && answers.abilityRollSeed.trim()
      ? answers.abilityRollSeed.trim()
      : "";
  const deadlandsTraitGenerationMethod =
    typeof answers.traitGenerationMethod === "string"
      ? answers.traitGenerationMethod
      : "standard-novice";
  const deadlandsTraitBudget =
    typeof answers.traitPointBudget === "number"
      ? answers.traitPointBudget
      : typeof answers.traitPointBudget === "string"
        ? Number(answers.traitPointBudget)
        : 30;
  const deadlandsTraitTotal = DEADLANDS_TRAIT_IDS.reduce((total, traitId) => {
    const raw = answers[traitId];
    const value =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 3;
    return total + (Number.isFinite(value) ? value : 3);
  }, 0);
  const deadlandsPrimarySkillDie =
    typeof answers.primarySkillDie === "string"
      ? Number(answers.primarySkillDie)
      : typeof answers.primarySkillDie === "number"
        ? answers.primarySkillDie
        : 10;
  const deadlandsSecondarySkillDie =
    typeof answers.secondarySkillDie === "string"
      ? Number(answers.secondarySkillDie)
      : typeof answers.secondarySkillDie === "number"
        ? answers.secondarySkillDie
        : 8;
  const deadlandsBaseSkillDie =
    typeof answers.skillBaseDie === "string"
      ? Number(answers.skillBaseDie)
      : typeof answers.skillBaseDie === "number"
        ? answers.skillBaseDie
        : 6;
  const deadlandsSkillBudget =
    typeof answers.skillPointBudget === "number"
      ? answers.skillPointBudget
      : typeof answers.skillPointBudget === "string"
        ? Number(answers.skillPointBudget)
        : 9;
  const deadlandsSkillSpent =
    (DEADLANDS_SKILL_POINT_COST_BY_DIE[deadlandsPrimarySkillDie] ?? 0) +
    (DEADLANDS_SKILL_POINT_COST_BY_DIE[deadlandsSecondarySkillDie] ?? 0) +
    (DEADLANDS_SKILL_POINT_COST_BY_DIE[deadlandsBaseSkillDie] ?? 0);
  const dndDerivedPreview = useMemo(() => {
    if (!isDnd5eRuleset) {
      return null;
    }

    const levelValue =
      typeof answers.level === "number"
        ? answers.level
        : typeof answers.level === "string" && answers.level.trim()
          ? Number(answers.level)
          : 1;
    const level = Number.isFinite(levelValue) ? Math.max(1, Math.min(20, Math.trunc(levelValue))) : 1;
    const characterClass =
      typeof answers.class === "string" && answers.class.trim()
        ? answers.class.trim()
        : "Fighter";
    const armor =
      typeof answers.armor === "string" && answers.armor.trim()
        ? answers.armor.trim()
        : "No Armor";
    const shieldEquipped =
      typeof answers.shieldEquipped === "string" && answers.shieldEquipped === "Yes";
    const fightingStyle =
      typeof answers.fightingStyle === "string" && answers.fightingStyle.trim()
        ? answers.fightingStyle.trim()
        : "Defense";
    const proficiencyBonus = level >= 17 ? 6 : level >= 13 ? 5 : level >= 9 ? 4 : level >= 5 ? 3 : 2;
    const classHitDie: Record<string, number> = {
      Barbarian: 12,
      Bard: 8,
      Cleric: 8,
      Druid: 8,
      Fighter: 10,
      Monk: 8,
      Paladin: 10,
      Ranger: 10,
      Rogue: 8,
      Sorcerer: 6,
      Warlock: 8,
      Wizard: 6,
    };
    const armorBase: Record<string, { base: number; dexCap: number | null }> = {
      "No Armor": { base: 10, dexCap: null },
      Leather: { base: 11, dexCap: null },
      "Studded Leather": { base: 12, dexCap: null },
      "Chain Shirt": { base: 13, dexCap: 2 },
      "Scale Mail": { base: 14, dexCap: 2 },
      Breastplate: { base: 14, dexCap: 2 },
      "Half Plate": { base: 15, dexCap: 2 },
      "Chain Mail": { base: 16, dexCap: 0 },
      Plate: { base: 18, dexCap: 0 },
    };
    const dexMod = getDndAbilityModifier(dndFinalAbilityScores.dex);
    const conMod = getDndAbilityModifier(dndFinalAbilityScores.con);
    const wisMod = getDndAbilityModifier(dndFinalAbilityScores.wis);
    const intMod = getDndAbilityModifier(dndFinalAbilityScores.int);
    const chaMod = getDndAbilityModifier(dndFinalAbilityScores.cha);
    const hpMax =
      (classHitDie[characterClass] ?? 8) +
      Math.max(1, conMod) +
      Math.max(0, level - 1) * (Math.floor((classHitDie[characterClass] ?? 8) / 2) + 1 + Math.max(1, conMod));
    const armorProfile = armorBase[armor] ?? armorBase["No Armor"];
    const armorDexBonus =
      armorProfile.dexCap === null
        ? Math.max(0, dexMod)
        : Math.max(0, Math.min(dexMod, armorProfile.dexCap));
    let ac = armorProfile.base + armorDexBonus;
    if (characterClass === "Barbarian" && armor === "No Armor") {
      ac = 10 + Math.max(0, dexMod) + Math.max(0, conMod);
    }
    if (characterClass === "Monk" && armor === "No Armor") {
      ac = 10 + Math.max(0, dexMod) + Math.max(0, wisMod);
    }
    if (
      fightingStyle === "Defense" &&
      ["Fighter", "Paladin", "Ranger"].includes(characterClass) &&
      armor !== "No Armor"
    ) {
      ac += 1;
    }
    if (shieldEquipped) {
      ac += 2;
    }
    const spellAbilityMod =
      characterClass === "Wizard"
        ? intMod
        : characterClass === "Cleric" || characterClass === "Druid" || characterClass === "Ranger"
          ? wisMod
          : characterClass === "Bard" ||
              characterClass === "Paladin" ||
              characterClass === "Sorcerer" ||
              characterClass === "Warlock"
            ? chaMod
            : null;
    const spellAttackBonus =
      spellAbilityMod === null ? null : proficiencyBonus + spellAbilityMod;
    const spellSaveDc =
      spellAbilityMod === null ? null : 8 + proficiencyBonus + spellAbilityMod;

    return {
      hpMax,
      ac,
      initiativeBonus: dexMod,
      proficiencyBonus,
      spellAttackBonus,
      spellSaveDc,
    };
  }, [answers, dndFinalAbilityScores, isDnd5eRuleset]);

  const dndAbilityPanelQuestionIds = useMemo(
    () =>
      [
        ...dndAbilityConfigQuestions.map((question) => question.id),
        ...dndAbilityScoreQuestions.map((question) => question.id),
      ],
    [dndAbilityConfigQuestions, dndAbilityScoreQuestions],
  );
  const dndCorePanelQuestionIds = useMemo(
    () => dndCoreStatsQuestions.map((question) => question.id),
    [dndCoreStatsQuestions],
  );
  const deadlandsTraitsPanelQuestionIds = useMemo(
    () => deadlandsTraitStatsQuestions.map((question) => question.id),
    [deadlandsTraitStatsQuestions],
  );
  const deadlandsSkillsPanelQuestionIds = useMemo(
    () => deadlandsSkillStatsQuestions.map((question) => question.id),
    [deadlandsSkillStatsQuestions],
  );
  const deadlandsResourcesPanelQuestionIds = useMemo(
    () => deadlandsResourceStatsQuestions.map((question) => question.id),
    [deadlandsResourceStatsQuestions],
  );
  const deadlandsCorePanelQuestionIds = useMemo(
    () => deadlandsCoreStatsQuestions.map((question) => question.id),
    [deadlandsCoreStatsQuestions],
  );

  const countErrorsByQuestionIds = useCallback(
    (questionIds: string[]) =>
      questionIds.reduce((count, questionId) => count + (liveFieldErrors[questionId] ? 1 : 0), 0),
    [liveFieldErrors],
  );

  const statsPanelErrorCount = useMemo(() => {
    if (isDnd5eRuleset) {
      return countErrorsByQuestionIds([
        ...dndAbilityPanelQuestionIds,
        ...dndCorePanelQuestionIds,
      ]);
    }
    if (isDeadlandsRuleset) {
      return countErrorsByQuestionIds([
        ...deadlandsTraitsPanelQuestionIds,
        ...deadlandsSkillsPanelQuestionIds,
        ...deadlandsResourcesPanelQuestionIds,
        ...deadlandsCorePanelQuestionIds,
      ]);
    }
    return countErrorsByQuestionIds(statsQuestions.map((question) => question.id));
  }, [
    deadlandsCorePanelQuestionIds,
    deadlandsResourcesPanelQuestionIds,
    deadlandsSkillsPanelQuestionIds,
    deadlandsTraitsPanelQuestionIds,
    dndAbilityPanelQuestionIds,
    dndCorePanelQuestionIds,
    isDeadlandsRuleset,
    isDnd5eRuleset,
    statsQuestions,
    countErrorsByQuestionIds,
  ]);
  const spellsPanelErrorCount = useMemo(
    () => countErrorsByQuestionIds(spellQuestions.map((question) => question.id)),
    [countErrorsByQuestionIds, spellQuestions],
  );
  const equipmentPanelErrorCount = useMemo(
    () => countErrorsByQuestionIds(equipmentQuestions.map((question) => question.id)),
    [countErrorsByQuestionIds, equipmentQuestions],
  );

  useEffect(() => {
    if (!abilityGenerationNotice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setAbilityGenerationNotice(""), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [abilityGenerationNotice]);
  const reviewSummaryQuestions = useMemo(() => {
    const ordered = [...visibleQuestions];
    const includeIfMissing = ["background", "personality"];
    for (const questionId of includeIfMissing) {
      if (ordered.some((question) => question.id === questionId)) {
        continue;
      }
      const sourceQuestion = questions.find((question) => question.id === questionId);
      if (sourceQuestion) {
        ordered.push(sourceQuestion);
      }
    }
    return ordered;
  }, [questions, visibleQuestions]);
  const hasFieldErrors = useMemo(
    () => Object.values(liveFieldErrors).some((errorMessage) => Boolean(errorMessage)),
    [liveFieldErrors],
  );

  useEffect(() => {
    if (!coachApplyNotice) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setCoachApplyNotice("");
    }, 1800);
    return () => window.clearTimeout(timeoutId);
  }, [coachApplyNotice]);

  useEffect(() => {
    const container = coachScrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [coachMessages]);

  function applyCoachSuggestion(fieldId: CoachFieldId, value: string, label: string) {
    if (isCoachLockableField(fieldId) && lockedFields[fieldId]) {
      setCoachApplyNotice(`${label} is locked. Unlock it to apply coach suggestions.`);
      return;
    }
    const previousValue = fieldId === "name" ? characterName : answers[fieldId];
    if (fieldId === "name") {
      setCharacterName((currentName) =>
        coachApplyMode === "append" && currentName.trim()
          ? `${currentName} ${value}`.trim()
          : value,
      );
    } else {
      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        [fieldId]:
          coachApplyMode === "append" && typeof currentAnswers[fieldId] === "string"
            ? `${currentAnswers[fieldId]}`.trim()
              ? `${currentAnswers[fieldId]}\n\n${value}`
              : value
            : value,
      }));
    }
    setCoachFieldBadges((current) => ({
      ...current,
      [fieldId]: `Coach ${coachApplyMode === "append" ? "append" : "replace"}`,
    }));
    setCoachLastAppliedByField((current) => ({
      ...current,
      [fieldId]: {
        previous: previousValue,
      },
    }));
    setCoachApplyNotice(`${label} ${coachApplyMode === "append" ? "appended" : "applied"}.`);
    console.info("[character-coach-apply]", {
      fieldId,
      mode: coachApplyMode,
      targetMode: coachTargetMode,
      locked: false,
    });
  }

  function clearCoachTrackingForField(fieldId: CoachFieldId) {
    if (coachFieldBadges[fieldId]) {
      setCoachFieldBadges((current) => {
        if (!current[fieldId]) {
          return current;
        }
        const next = { ...current };
        delete next[fieldId];
        return next;
      });
    }
    if (fieldId in coachLastAppliedByField) {
      setCoachLastAppliedByField((current) => {
        const next = { ...current };
        delete next[fieldId];
        return next;
      });
    }
  }

  function handleManualFieldChange(fieldId: string, value: string | number) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldId]: value,
    }));
    if (fieldId in coachLastAppliedByField || coachFieldBadges[fieldId]) {
      clearCoachTrackingForField(fieldId as CoachFieldId);
    }
  }

  function handleManualNameChange(value: string) {
    setCharacterName(value);
    clearCoachTrackingForField("name");
  }

  function handleUndoCoachApply(fieldId: CoachFieldId, label: string) {
    const lastApply = coachLastAppliedByField[fieldId];
    if (!lastApply) {
      return;
    }
    if (fieldId === "name") {
      setCharacterName(
        typeof lastApply.previous === "string" ? lastApply.previous : "",
      );
    } else {
      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        [fieldId]:
          typeof lastApply.previous === "number"
            ? lastApply.previous
            : typeof lastApply.previous === "string"
              ? lastApply.previous
              : "",
      }));
    }
    setCoachFieldBadges((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setCoachLastAppliedByField((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setCoachApplyNotice(`${label} restored.`);
  }

  function handleCoachInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendCoachMessage();
    }
  }

  async function handleSendCoachMessage(overrideMessage?: string | unknown) {
    const inputSource = typeof overrideMessage === "string" ? overrideMessage : coachInput;
    const trimmedInput = inputSource.trim();
    if (!trimmedInput || isSendingCoachMessage) {
      return;
    }

    const userMessage: CoachChatMessage = {
      role: "user",
      content: trimmedInput,
    };

    if (!overrideMessage) {
      setCoachInput("");
    }
    setCoachMessages((current) => [...current, userMessage]);
    setIsSendingCoachMessage(true);

    try {
      const response = await fetch("/api/character-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ruleset: selectedRuleset,
          message: trimmedInput,
          targetField: coachTargetMode,
          messages: [...coachMessages, userMessage].slice(-8),
          snapshot: {
            characterName,
            fields: {
              personality:
                typeof answers.personality === "string" ? answers.personality : "",
              background: typeof answers.background === "string" ? answers.background : "",
              physicalDescription:
                typeof answers.physicalDescription === "string"
                  ? answers.physicalDescription
                  : "",
            },
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Coach request failed.";
        throw new Error(message);
      }
      const normalized = normalizeCoachApiResponse(data);
      console.info("[character-coach-client]", {
        targetMode: coachTargetMode,
        retryUsed:
          normalized.meta &&
          typeof normalized.meta === "object" &&
          "retryUsed" in normalized.meta
            ? Boolean((normalized.meta as Record<string, unknown>).retryUsed)
            : false,
        warning: normalized.warning ?? null,
      });

      const assistantMessage: CoachChatMessage = {
        role: "assistant",
        content: normalized.message.content,
        warning: normalized.warning,
        suggestions: normalized.suggestions,
        options: normalized.options,
      };
      setCoachMessages((current) => [...current, assistantMessage]);
      if (normalized.warning) {
        setCoachApplyNotice(
          `Coach response was partial (${normalized.warning}). You can still apply available suggestions.`,
        );
      }
    } catch {
      setCoachMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: "Coach is unavailable right now. Try again in a moment.",
        },
      ]);
    } finally {
      setIsSendingCoachMessage(false);
    }
  }

  function handleCoachVariantRequest(variantKind: "darker" | "heroic" | "shorter") {
    const base = coachInput.trim();
    const promptBase = base || "Use your most recent suggestion as the base.";
    const variantPrompt =
      variantKind === "darker"
        ? `${promptBase}\n\nGive me 3 darker variants.`
        : variantKind === "heroic"
          ? `${promptBase}\n\nGive me 3 lighter heroic variants.`
          : `${promptBase}\n\nGive me 3 concise versions that are significantly shorter.`;
    void handleSendCoachMessage(variantPrompt);
  }

  function handleCoachQuickActionApply() {
    if (!coachQuickAction || isSendingCoachMessage) {
      return;
    }

    if (coachQuickAction === "name-ideas") {
      handleCoachNameIdeasRequest();
      setCoachQuickAction("");
      return;
    }
    if (coachQuickAction === "variant-darker") {
      handleCoachVariantRequest("darker");
      setCoachQuickAction("");
      return;
    }
    if (coachQuickAction === "variant-heroic") {
      handleCoachVariantRequest("heroic");
      setCoachQuickAction("");
      return;
    }
    if (coachQuickAction === "variant-shorter") {
      handleCoachVariantRequest("shorter");
      setCoachQuickAction("");
    }
  }

  function handleCoachNameIdeasRequest() {
    const prompt = `Suggest 5 character name options for this ${selectedRuleset} character.`;
    void handleSendCoachMessage(prompt);
  }

  function handleClearCoachChat() {
    setCoachMessages([
      {
        role: "assistant",
        content:
          "Ask for character ideas, tone, or writing help. Use the action buttons to copy suggestions into form fields.",
      },
    ]);
    setCoachInput("");
    setExpandedCoachOptionKeys({});
  }

  function toggleExpandedCoachOption(optionKey: string) {
    setExpandedCoachOptionKeys((current) => ({
      ...current,
      [optionKey]: !current[optionKey],
    }));
  }

  function renderCoachOptionText(optionText: string, optionKey: string) {
    const isLong = optionText.length > 280;
    const expanded = Boolean(expandedCoachOptionKeys[optionKey]);
    const visibleText = !isLong || expanded ? optionText : `${optionText.slice(0, 280).trimEnd()}…`;

    return (
      <div className="mt-1 text-xs text-cyan-50">
        <div>{visibleText}</div>
        {isLong ? (
          <button
            type="button"
            onClick={() => toggleExpandedCoachOption(optionKey)}
            className="mt-1 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/60"
          >
            {expanded ? "Show Less" : "Show More"}
          </button>
        ) : null}
      </div>
    );
  }

  function handleRestoreLastClearedDraft() {
    if (mode !== "create") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(getCharacterBuilderClearedDraftKey(selectedRuleset));
      if (!stored) {
        setCoachApplyNotice("No cleared draft available.");
        return;
      }
      const parsed = JSON.parse(stored) as {
        characterName?: unknown;
        answers?: unknown;
      };
      if (typeof parsed.characterName === "string") {
        setCharacterName(parsed.characterName);
      }
      const restoredAnswers =
        parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
          ? (parsed.answers as Record<string, string | number>)
          : {};
      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        ...restoredAnswers,
      }));
      setCoachApplyNotice("Restored last cleared draft.");
    } catch {
      setCoachApplyNotice("Unable to restore cleared draft.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (liveValidationError) {
      return;
    }

    if (!characterName.trim() || isSubmitting) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const requestBody =
        submitBodyBuilder?.({
          mode,
          selectedRuleset,
          characterName: characterName.trim(),
          answers,
        }) ?? {
          name: characterName.trim(),
          ...(mode === "create" ? { ruleset: selectedRuleset } : {}),
          answers,
        };
      const response = await fetch(submitUrl, {
        method: submitMethod,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json().catch(() => null);
      const dataRecord =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {};
      const character =
        dataRecord.character &&
        typeof dataRecord.character === "object" &&
        !Array.isArray(dataRecord.character)
          ? (dataRecord.character as Record<string, unknown>)
          : null;
      const characterId =
        character && typeof character.id === "string" ? character.id : "";

      if (!response.ok || !characterId) {
        throw new Error(
          (typeof dataRecord.error === "string" ? dataRecord.error : undefined) ??
            (mode === "create"
              ? "Unable to create library character."
              : "Unable to update library character."),
        );
      }

      if (onSubmitSuccess && character) {
        await onSubmitSuccess({
          character,
          rawResponse: dataRecord,
        });
      }

      if (!redirectOnSuccess) {
        setIsSubmitting(false);
        return;
      }

      if (mode === "create") {
        try {
          window.localStorage.setItem(
            getCharacterBuilderClearedDraftKey(selectedRuleset),
            JSON.stringify({
              characterName,
              answers,
            }),
          );
          window.localStorage.removeItem(getCharacterBuilderDraftKey(selectedRuleset));
          setHasRestorableDraft(true);
        } catch {
          // No-op
        }
        router.push(
          appendQueryParamsToPath(returnTo, {
            ruleset: selectedRuleset,
            libraryCharacterId: characterId,
          }),
        );
        return;
      }

      router.push(returnTo);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : mode === "create"
            ? "Unable to create library character."
            : "Unable to update library character.",
      );
      setIsSubmitting(false);
    }
  }

  async function handleGeneratePortrait() {
    const physicalDescription =
      typeof answers.physicalDescription === "string"
        ? answers.physicalDescription.trim()
        : "";

    if (!selectedRuleset || !physicalDescription || isGeneratingPortrait) {
      return;
    }

    setError("");
    setIsGeneratingPortrait(true);

    try {
      const response = await fetch("/api/library-characters/portrait", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: characterName.trim() || "Character",
          ruleset: selectedRuleset,
          physicalDescription,
        }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.portraitDataUrl !== "string") {
        throw new Error(data.error ?? "Unable to generate portrait.");
      }

      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        portraitDataUrl: data.portraitDataUrl,
      }));
    } catch (portraitError) {
      setError(
        portraitError instanceof Error
          ? portraitError.message
          : "Unable to generate portrait.",
      );
    } finally {
      setIsGeneratingPortrait(false);
    }
  }

  async function handlePortraitUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        portraitDataUrl: dataUrl,
      }));
    } catch {
      setError("Unable to load uploaded portrait.");
    }
  }

  async function handleGenerateToken() {
    const physicalDescription =
      typeof answers.physicalDescription === "string"
        ? answers.physicalDescription.trim()
        : "";

    if (!selectedRuleset || !physicalDescription || isGeneratingToken) {
      return;
    }

    setError("");
    setIsGeneratingToken(true);

    try {
      const response = await fetch("/api/library-characters/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: characterName.trim() || "Character",
          ruleset: selectedRuleset,
          physicalDescription,
        }),
      });
      const data = await response.json();

      if (!response.ok || typeof data.tokenDataUrl !== "string") {
        throw new Error(data.error ?? "Unable to generate token.");
      }

      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        tokenDataUrl: data.tokenDataUrl,
      }));
    } catch (tokenError) {
      setError(
        tokenError instanceof Error
          ? tokenError.message
          : "Unable to generate token.",
      );
    } finally {
      setIsGeneratingToken(false);
    }
  }

  async function handleTokenUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        tokenDataUrl: dataUrl,
      }));
    } catch {
      setError("Unable to load uploaded token image.");
    }
  }

  function getStepQuestionIds(step: CharacterBuilderStep): string[] {
    if (step === "identity") {
      return identityQuestionsForRender.map((question) => question.id);
    }
    if (step === "description") {
      return descriptionQuestions.map((question) => question.id);
    }
    if (step === "spells") {
      return spellQuestions.map((question) => question.id);
    }
    if (step === "equipment") {
      return equipmentQuestions.map((question) => question.id);
    }
    if (step === "portrait") {
      return partitionedQuestions.physicalDescriptionQuestion
        ? [partitionedQuestions.physicalDescriptionQuestion.id]
        : [];
    }
    if (step === "stats") {
      if (isDnd5eRuleset) {
        return [...dndAbilityPanelQuestionIds, ...dndCorePanelQuestionIds];
      }
      if (isDeadlandsRuleset) {
        return [
          ...deadlandsTraitsPanelQuestionIds,
          ...deadlandsSkillsPanelQuestionIds,
          ...deadlandsResourcesPanelQuestionIds,
          ...deadlandsCorePanelQuestionIds,
        ];
      }
      return statsQuestions.map((question) => question.id);
    }
    return [];
  }

  function focusFieldByQuestionId(questionId: string) {
    const fieldElement = document.getElementById(`field-${questionId}`) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    if (!fieldElement) {
      return;
    }
    fieldElement.focus();
    fieldElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function focusFieldAfterRender(questionId: string) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusFieldByQuestionId(questionId);
      });
    });
  }

  function setDeadlandsSubpanelForQuestionId(questionId: string) {
    if (!isDeadlandsRuleset) {
      return;
    }
    if (deadlandsTraitsPanelQuestionIds.includes(questionId)) {
      setActiveStatsSubpanel("traits");
      return;
    }
    if (deadlandsSkillsPanelQuestionIds.includes(questionId)) {
      setActiveStatsSubpanel("skills");
      return;
    }
    if (deadlandsResourcesPanelQuestionIds.includes(questionId)) {
      setActiveStatsSubpanel("resources");
      return;
    }
    setActiveStatsSubpanel("core");
  }

  function handleJumpToFirstErrorInCurrentPanel() {
    const currentStepErrorQuestionId = getStepQuestionIds(activeStep).find(
      (questionId) => liveFieldErrors[questionId],
    );
    if (currentStepErrorQuestionId) {
      if (activeStep === "stats" && isDeadlandsRuleset) {
        setDeadlandsSubpanelForQuestionId(currentStepErrorQuestionId);
        focusFieldAfterRender(currentStepErrorQuestionId);
        return;
      }
      focusFieldAfterRender(currentStepErrorQuestionId);
      return;
    }

    const destinationStep = CHARACTER_BUILDER_STEPS.find((step) =>
      getStepQuestionIds(step.id).some((questionId) => liveFieldErrors[questionId]),
    )?.id;

    if (!destinationStep) {
      return;
    }

    const destinationQuestionId = getStepQuestionIds(destinationStep).find(
      (questionId) => liveFieldErrors[questionId],
    );
    if (!destinationQuestionId) {
      return;
    }

    if (destinationStep === "stats" && isDeadlandsRuleset) {
      setDeadlandsSubpanelForQuestionId(destinationQuestionId);
    }

    setActiveStep(destinationStep);
    focusFieldAfterRender(destinationQuestionId);
  }

  function handleDndAbilityScoreChange(
    abilityId: (typeof DND_ABILITY_IDS)[number],
    nextScore: number,
  ) {
    const currentScore = dndAbilityScores[abilityId];
    const method = dndAbilityGenerationMethod;

    if (method === "standard-array") {
      if (!DND_STANDARD_ARRAY.includes(nextScore as (typeof DND_STANDARD_ARRAY)[number])) {
        return;
      }
      if (!canAssignStandardArrayValue(dndAbilityScores, abilityId, nextScore)) {
        const duplicateOwner = DND_ABILITY_IDS.find(
          (id) => id !== abilityId && dndAbilityScores[id] === nextScore,
        );
        setAbilityGenerationNotice(
          `${nextScore} is already assigned to ${(duplicateOwner ?? abilityId).toUpperCase()}.`,
        );
        return;
      }
      handleManualFieldChange(abilityId, nextScore);
      return;
    }

    if (method === "point-buy") {
      const clampedNextScore = Math.max(8, Math.min(15, Math.trunc(nextScore)));
      if (clampedNextScore === currentScore) {
        return;
      }
      const currentSpent = getDndPointBuySpent(
        DND_ABILITY_IDS.map((id) => dndAbilityScores[id]),
      );
      const projectedScores = DND_ABILITY_IDS.map((id) =>
        id === abilityId ? clampedNextScore : dndAbilityScores[id],
      );
      const projectedSpent = getDndPointBuySpent(projectedScores);
      if (projectedSpent > 27 && projectedSpent >= currentSpent) {
        setAbilityGenerationNotice("Point Buy budget exceeded (27 max).");
        return;
      }
      handleManualFieldChange(abilityId, clampedNextScore);
      return;
    }

    if (method === "roll-4d6") {
      const rolledScore = Math.max(3, Math.min(18, Math.trunc(nextScore)));
      handleManualFieldChange(abilityId, rolledScore);
      return;
    }

    const manualScore = Math.max(8, Math.min(20, Math.trunc(nextScore)));
    handleManualFieldChange(abilityId, manualScore);
  }

  function handleApplyRecommendedStandardArray() {
    const selectedClass =
      typeof answers.class === "string" && answers.class.trim()
        ? answers.class.trim()
        : "Fighter";
    const recommendation = applyRecommendedStandardArrayForClass(selectedClass);
    for (const abilityId of DND_ABILITY_IDS) {
      handleManualFieldChange(abilityId, recommendation[abilityId]);
    }
    setAbilityGenerationNotice(`Applied recommended Standard Array for ${selectedClass}.`);
  }

  function handleRollAbilityScores() {
    const seedSource =
      dndAbilityRollSeed ||
      `${characterName || "character"}-${Date.now()}`;
    const rolled = rollAbilityScoresFromSeed(seedSource);
    for (const abilityId of DND_ABILITY_IDS) {
      handleManualFieldChange(abilityId, rolled[abilityId]);
    }
    if (!dndAbilityRollSeed) {
      handleManualFieldChange("abilityRollSeed", seedSource);
    }
    setAbilityGenerationNotice(`Rolled ability scores from seed: ${seedSource}`);
  }

  function renderDndAbilityControls() {
    const overrideHpEnabled = String(answers.overrideHpMaxEnabled ?? "false") === "true";
    const overrideAcEnabled = String(answers.overrideAcEnabled ?? "false") === "true";
    const overrideSpellAttackEnabled = String(answers.overrideSpellAttackBonusEnabled ?? "false") === "true";
    const overrideSpellSaveEnabled = String(answers.overrideSpellSaveDcEnabled ?? "false") === "true";
    const overrideHpValue =
      typeof answers.overrideHpMax === "number"
        ? answers.overrideHpMax
        : dndDerivedPreview?.hpMax ?? 1;
    const overrideAcValue =
      typeof answers.overrideAc === "number"
        ? answers.overrideAc
        : dndDerivedPreview?.ac ?? 10;
    const overrideSpellAttackValue =
      typeof answers.overrideSpellAttackBonus === "number"
        ? answers.overrideSpellAttackBonus
        : dndDerivedPreview?.spellAttackBonus ?? 0;
    const overrideSpellSaveValue =
      typeof answers.overrideSpellSaveDc === "number"
        ? answers.overrideSpellSaveDc
        : dndDerivedPreview?.spellSaveDc ?? 10;

    return (
      <div className="mb-4 space-y-3 rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-3">
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-[0.11em] text-cyan-100/85">
            {dndAbilityGenerationQuestion?.label ?? "Ability Generation Method"}
          </label>
          <select
            id="field-abilityGenerationMethod"
            value={dndAbilityGenerationMethod}
            onChange={(event) => {
              handleManualFieldChange("abilityGenerationMethod", event.target.value);
              setAbilityGenerationNotice("");
            }}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
          >
            <option value="manual-enter">Manual Entry</option>
            <option value="standard-array">Standard Array</option>
            <option value="point-buy">Point Buy</option>
            <option value="roll-4d6">Roll 4d6 Drop Lowest</option>
          </select>
          {liveFieldErrors.abilityGenerationMethod ? (
            <p className="text-[11px] text-rose-300">{liveFieldErrors.abilityGenerationMethod}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100/90">
            D&D Ability Generation
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
              {dndAbilityGenerationMethod === "standard-array"
                ? "Standard Array"
                : dndAbilityGenerationMethod === "point-buy"
                  ? "Point Buy"
                  : dndAbilityGenerationMethod === "roll-4d6"
                    ? "Roll 4d6"
                  : "Manual Entry"}
            </span>
            <button
              type="button"
              onClick={handleApplyRecommendedStandardArray}
              className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
            >
              Apply Recommended Array
            </button>
          </div>
        </div>
        {dndAbilityGenerationMethod === "roll-4d6" ? (
          <div className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/55 p-2.5 text-xs text-slate-200 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-cyan-100/85">
                Roll Seed
              </span>
              <input
                id="field-abilityRollSeed"
                type="text"
                value={dndAbilityRollSeed}
                onChange={(event) => handleManualFieldChange("abilityRollSeed", event.target.value)}
                placeholder="optional-seed"
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
              />
            </label>
            <button
              type="button"
              onClick={handleRollAbilityScores}
              className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
            >
              Roll Abilities
            </button>
          </div>
        ) : null}
        {dndAbilityGenerationMethod === "standard-array" ? (
          <p className="text-xs text-cyan-50/90">
            Expected set: 15, 14, 13, 12, 10, 8.
            {" "}
            {dndStandardArrayMatches ? "Current scores match." : "Assign each value once."}
          </p>
        ) : null}
        {dndAbilityGenerationMethod === "point-buy" ? (
          <div className="space-y-1 text-xs text-cyan-50/90">
            <p>
              Point Buy budget: 27.
              {" "}
              Spent: {dndPointBuySpent}
              {" "}
              ({dndPointBuyRemaining >= 0 ? `${dndPointBuyRemaining} remaining` : `${Math.abs(dndPointBuyRemaining)} over`}).
              {dndPointBuyOutOfRangeIds.length > 0
                ? " Scores must stay between 8 and 15."
                : ""}
            </p>
            <p className={dndPointBuyRemaining >= 0 && dndPointBuyOutOfRangeIds.length === 0 ? "text-emerald-200" : "text-amber-100"}>
              {dndPointBuyRemaining >= 0 && dndPointBuyOutOfRangeIds.length === 0
                ? "Legal point-buy distribution."
                : "Illegal point-buy distribution."}
            </p>
          </div>
        ) : null}
        {abilityGenerationNotice ? (
          <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-2.5 py-1.5 text-xs text-amber-100">
            {abilityGenerationNotice}
          </div>
        ) : null}
        {dndDerivedPreview ? (
          <div className="grid gap-2 rounded-xl border border-white/10 bg-slate-950/55 p-2.5 text-xs text-slate-200 sm:grid-cols-3">
            <div>HP Max: {dndDerivedPreview.hpMax}</div>
            <div>AC: {dndDerivedPreview.ac}</div>
            <div>Initiative: {dndDerivedPreview.initiativeBonus >= 0 ? `+${dndDerivedPreview.initiativeBonus}` : dndDerivedPreview.initiativeBonus}</div>
            <div>Prof Bonus: {dndDerivedPreview.proficiencyBonus >= 0 ? `+${dndDerivedPreview.proficiencyBonus}` : dndDerivedPreview.proficiencyBonus}</div>
            <div>Spell Attack: {dndDerivedPreview.spellAttackBonus === null ? "N/A" : (dndDerivedPreview.spellAttackBonus >= 0 ? `+${dndDerivedPreview.spellAttackBonus}` : dndDerivedPreview.spellAttackBonus)}</div>
            <div>Spell Save DC: {dndDerivedPreview.spellSaveDc ?? "N/A"}</div>
          </div>
        ) : null}
        <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/55 p-2.5 text-xs text-slate-200">
          <button
            type="button"
            onClick={() => setDndOverridesCollapsed((current) => !current)}
            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-slate-900/50 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200 transition hover:border-white/20"
          >
            <span>Derived Overrides</span>
            <span className="text-[10px] text-slate-400">
              {dndOverridesCollapsed ? "Expand" : "Collapse"}
            </span>
          </button>
          {!dndOverridesCollapsed ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">
              HP Max
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={overrideHpValue}
                disabled={!overrideHpEnabled}
                onChange={(event) => handleManualFieldChange("overrideHpMax", Number(event.target.value))}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={overrideHpEnabled}
                  onChange={(event) =>
                    handleManualFieldChange("overrideHpMaxEnabled", event.target.checked ? "true" : "false")
                  }
                />
                Override
              </label>
            </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">
              AC
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={overrideAcValue}
                disabled={!overrideAcEnabled}
                onChange={(event) => handleManualFieldChange("overrideAc", Number(event.target.value))}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={overrideAcEnabled}
                  onChange={(event) =>
                    handleManualFieldChange("overrideAcEnabled", event.target.checked ? "true" : "false")
                  }
                />
                Override
              </label>
            </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">
              Spell Attack
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={overrideSpellAttackValue}
                disabled={!overrideSpellAttackEnabled}
                onChange={(event) => handleManualFieldChange("overrideSpellAttackBonus", Number(event.target.value))}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={overrideSpellAttackEnabled}
                  onChange={(event) =>
                    handleManualFieldChange("overrideSpellAttackBonusEnabled", event.target.checked ? "true" : "false")
                  }
                />
                Override
              </label>
            </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">
              Spell Save DC
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={overrideSpellSaveValue}
                disabled={!overrideSpellSaveEnabled}
                onChange={(event) => handleManualFieldChange("overrideSpellSaveDc", Number(event.target.value))}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 disabled:opacity-50"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={overrideSpellSaveEnabled}
                  onChange={(event) =>
                    handleManualFieldChange("overrideSpellSaveDcEnabled", event.target.checked ? "true" : "false")
                  }
                />
                Override
              </label>
            </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DND_ABILITY_IDS.map((abilityId) => {
            const question = dndAbilityScoreQuestionById[abilityId];
            if (!question) {
              return null;
            }
            const score = dndAbilityScores[abilityId];
            const finalScore = dndFinalAbilityScores[abilityId];
            const bonus = dndAbilityBonuses[abilityId];
            const usedByOther = DND_ABILITY_IDS.filter(
              (id) => id !== abilityId,
            ).map((id) => dndAbilityScores[id]);
            const compactLabel =
              DND_ABILITY_LABEL_ABBREVIATIONS[question.label.trim().toLowerCase()] ??
              question.label.toUpperCase();
            return (
              <div
                key={abilityId}
                className="rounded-xl border border-white/10 bg-slate-950/60 p-2"
              >
                <div className="mb-1.5 flex items-center justify-between gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200">
                    {compactLabel}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1 text-[9px] leading-none">
                    <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-1 py-[2px] text-cyan-100">
                    Final {finalScore}
                    </span>
                    {bonus !== 0 ? (
                      <span className="rounded-md border border-white/15 bg-slate-900/70 px-1 py-[2px] text-slate-300">
                        Base {score}{bonus > 0 ? `+${bonus}` : bonus}
                      </span>
                    ) : null}
                  </div>
                </div>
                {dndAbilityGenerationMethod === "standard-array" ? (
                  <div className="flex items-center justify-between gap-2">
                    <select
                      id={`field-${abilityId}`}
                      value={score}
                      onChange={(event) =>
                        handleDndAbilityScoreChange(abilityId, Number(event.target.value))
                      }
                      className="min-w-[110px] rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
                    >
                      {DND_STANDARD_ARRAY.map((optionValue) => (
                        <option
                          key={optionValue}
                          value={optionValue}
                          disabled={usedByOther.includes(optionValue)}
                        >
                          {optionValue}
                        </option>
                      ))}
                    </select>
                    <span className="whitespace-nowrap rounded-md border border-white/15 bg-slate-900/70 px-1.5 py-[2px] text-[9px] leading-none text-slate-300">
                      Pick value
                    </span>
                  </div>
                ) : null}
                {dndAbilityGenerationMethod === "point-buy" ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDndAbilityScoreChange(abilityId, score - 1)}
                        disabled={score <= 8}
                        className="rounded-md border border-white/20 bg-slate-900 px-2 py-0.5 text-sm text-slate-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Decrease ${question.label}`}
                      >
                        -
                      </button>
                      <div className="min-w-12 rounded-md border border-white/15 bg-slate-900 px-2 py-0.5 text-center text-sm text-slate-100">
                        {score}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDndAbilityScoreChange(abilityId, score + 1)}
                        disabled={
                          !canIncreasePointBuyScore(dndAbilityScores, abilityId)
                        }
                        className="rounded-md border border-white/20 bg-slate-900 px-2 py-0.5 text-sm text-slate-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Increase ${question.label}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="whitespace-nowrap rounded-md border border-amber-300/25 bg-amber-300/10 px-1.5 py-[2px] text-[9px] leading-none text-amber-100">
                      {`Cost ${DND_POINT_BUY_COST_BY_SCORE[Math.max(8, Math.min(15, Math.trunc(score)))] ?? 0}`}
                    </span>
                  </div>
                ) : null}
                {dndAbilityGenerationMethod === "manual-enter" ? (
                  <div className="flex items-center justify-between gap-2">
                    <input
                      id={`field-${abilityId}`}
                      type="number"
                      inputMode="numeric"
                      min={8}
                      max={20}
                      value={score}
                      onChange={(event) =>
                        handleDndAbilityScoreChange(abilityId, Number(event.target.value))
                      }
                      className="min-w-[110px] rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
                    />
                    <span className="whitespace-nowrap rounded-md border border-white/15 bg-slate-900/70 px-1.5 py-[2px] text-[9px] leading-none text-slate-300">
                      Edit value
                    </span>
                  </div>
                ) : null}
                {dndAbilityGenerationMethod === "roll-4d6" ? (
                  <div className="flex items-center justify-between gap-2">
                    <input
                      id={`field-${abilityId}`}
                      type="number"
                      inputMode="numeric"
                      min={3}
                      max={18}
                      value={score}
                      onChange={(event) =>
                        handleDndAbilityScoreChange(abilityId, Number(event.target.value))
                      }
                      className="min-w-[110px] rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60"
                    />
                    <span className="whitespace-nowrap rounded-md border border-white/15 bg-slate-900/70 px-1.5 py-[2px] text-[9px] leading-none text-slate-300">
                      Roll result
                    </span>
                  </div>
                ) : null}
                {liveFieldErrors[abilityId] ? (
                  <p className="mt-2 text-[11px] text-rose-300">{liveFieldErrors[abilityId]}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderDeadlandsAllocationSummary() {
    const traitBudgetTarget =
      deadlandsTraitGenerationMethod === "standard-novice"
        ? 30
        : Number.isFinite(deadlandsTraitBudget)
          ? deadlandsTraitBudget
          : 30;
    const traitDelta = deadlandsTraitTotal - traitBudgetTarget;
    const skillBudgetTarget = Number.isFinite(deadlandsSkillBudget) ? deadlandsSkillBudget : 9;
    const skillDelta = deadlandsSkillSpent - skillBudgetTarget;

    return (
      <div className="mb-4 space-y-2 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-100/90">
          Deadlands Allocation
        </div>
        <div className="grid gap-2 text-xs text-amber-50/90 sm:grid-cols-2">
          <div>
            Trait method:{" "}
            {deadlandsTraitGenerationMethod === "standard-novice"
              ? "Standard novice"
              : deadlandsTraitGenerationMethod === "custom-budget"
                ? "Custom budget"
                : "Manual open"}
          </div>
          <div>
            Traits: {deadlandsTraitTotal}/{traitBudgetTarget}
            {traitDelta === 0 ? " (on target)" : traitDelta > 0 ? ` (+${traitDelta})` : ` (${traitDelta})`}
          </div>
          <div>
            Skill points: {deadlandsSkillSpent}/{skillBudgetTarget}
            {skillDelta === 0 ? " (on target)" : skillDelta > 0 ? ` (+${skillDelta})` : ` (${skillDelta})`}
          </div>
          <div>
            Skill dice: P d{deadlandsPrimarySkillDie || 10} / S d{deadlandsSecondarySkillDie || 8} / Base d{deadlandsBaseSkillDie || 6}
          </div>
        </div>
      </div>
    );
  }

  function toggleSectionCollapse(sectionId: string) {
    setCollapsedSectionMap((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function renderQuestionSection(
    sectionId: string,
    title: string,
    questionList: CharacterQuestion[],
    dense = false,
  ) {
    if (questionList.length === 0) {
      return null;
    }
    const collapsed = Boolean(collapsedSectionMap[sectionId]);
    return (
      <div className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
        <button
          type="button"
          onClick={() => toggleSectionCollapse(sectionId)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
            {title}
          </span>
          <span className="text-[11px] text-slate-400">{collapsed ? "Expand" : "Collapse"}</span>
        </button>
        {!collapsed ? <div className="mt-3">{renderQuestions(questionList, dense)}</div> : null}
      </div>
    );
  }

  function renderTabLabel(label: string, errorCount: number) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{label}</span>
        {errorCount > 0 ? (
          <span className="rounded-full border border-rose-300/40 bg-rose-400/15 px-1.5 py-0.5 text-[10px] leading-none text-rose-200">
            {errorCount}
          </span>
        ) : null}
      </span>
    );
  }

  function renderStatsPanel() {
    if (isDnd5eRuleset) {
      return (
        <div className="space-y-3">
          {renderDndAbilityControls()}
          {renderQuestionSection(
            "dnd-abilities-config",
            "Ability Configuration",
            dndAbilityConfigQuestions,
            true,
          )}
          {renderQuestionSection("dnd-core-fields", "Core Stats", dndCoreStatsQuestions, true)}
        </div>
      );
    }

    if (isDeadlandsRuleset) {
      const deadlandsTabOptions: Array<{ id: StatsSubpanel; label: string }> = [
        { id: "traits", label: "Traits" },
        { id: "skills", label: "Skills" },
        { id: "resources", label: "Wounds/Fate" },
        { id: "core", label: "Core" },
      ];
      const activeTab =
        activeStatsSubpanel === "traits" ||
        activeStatsSubpanel === "skills" ||
        activeStatsSubpanel === "resources" ||
        activeStatsSubpanel === "core"
          ? activeStatsSubpanel
          : "traits";
      const questionsForTab =
        activeTab === "traits"
          ? deadlandsTraitStatsQuestions
          : activeTab === "skills"
            ? deadlandsSkillStatsQuestions
            : activeTab === "resources"
              ? deadlandsResourceStatsQuestions
              : deadlandsCoreStatsQuestions;

      return (
        <div className="space-y-3">
          <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-slate-950/70 p-1">
            {deadlandsTabOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setActiveStatsSubpanel(option.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  activeTab === option.id
                    ? "bg-amber-300/15 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {renderTabLabel(
                  option.label,
                  option.id === "traits"
                    ? countErrorsByQuestionIds(deadlandsTraitsPanelQuestionIds)
                    : option.id === "skills"
                      ? countErrorsByQuestionIds(deadlandsSkillsPanelQuestionIds)
                      : option.id === "resources"
                        ? countErrorsByQuestionIds(deadlandsResourcesPanelQuestionIds)
                        : countErrorsByQuestionIds(deadlandsCorePanelQuestionIds),
                )}
              </button>
            ))}
          </div>
          {activeTab === "traits" || activeTab === "skills" ? renderDeadlandsAllocationSummary() : null}
          {renderQuestionSection(
            `deadlands-${activeTab}-fields`,
            activeTab === "resources"
              ? "Wounds, Fate, and Overrides"
              : activeTab === "skills"
                ? "Skills and Dice"
                : activeTab === "traits"
                  ? "Trait Allocation"
                  : "Core Stats",
            questionsForTab,
            true,
          )}
        </div>
      );
    }

    return renderQuestionSection("generic-stats-fields", "Stats", statsQuestions, true);
  }

  function renderQuestions(questionList: CharacterQuestion[], dense = false) {
    if (questionList.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
          No fields are active for this step yet.
        </div>
      );
    }

    return (
      <div className={dense ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-4 sm:grid-cols-2"}>
        {questionList.map((question) => (
          <CharacterQuestionField
            key={question.id}
            question={question}
            value={answers[question.id]}
            errorMessage={liveFieldErrors[question.id]}
            locked={Boolean(lockedFields[question.id])}
            onToggleLock={() =>
              setLockedFields((current) => ({
                ...current,
                [question.id]: !current[question.id],
              }))
            }
            onChange={(value) =>
              handleManualFieldChange(question.id, value)
            }
            coachBadge={coachFieldBadges[question.id]}
            showLockControl={isCoachLockableField(question.id)}
            canUndoCoachApply={
              isCoachLockableField(question.id) &&
              Boolean(coachLastAppliedByField[question.id as CoachFieldId])
            }
            onUndoCoachApply={
              isCoachLockableField(question.id)
                ? () =>
                    handleUndoCoachApply(
                      question.id as CoachFieldId,
                      question.label,
                    )
                : undefined
            }
          />
        ))}
      </div>
    );
  }

  function renderSpellQuestions(questionList: CharacterQuestion[]) {
    if (questionList.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
          No spell fields are active for this step yet.
        </div>
      );
    }

    if (selectedRuleset.trim().toLowerCase() === "deadlands classic") {
      return renderQuestionSection("deadlands-spells", "Powers", questionList, true);
    }

    const groupedQuestions = [
      {
        label: "Cantrips",
        questions: questionList.filter((question) => /cantrip/i.test(question.id)),
      },
      {
        label: "Level 1",
        questions: questionList.filter((question) => /spellLevel1/i.test(question.id)),
      },
      {
        label: "Level 2",
        questions: questionList.filter((question) => /spellLevel2/i.test(question.id)),
      },
      {
        label: "Level 3",
        questions: questionList.filter((question) => /spellLevel3/i.test(question.id)),
      },
      {
        label: "Other Spells",
        questions: questionList.filter(
          (question) =>
            !/cantrip/i.test(question.id) &&
            !/spellLevel[123]/i.test(question.id),
        ),
      },
    ].filter((group) => group.questions.length > 0);

    return (
      <div className="space-y-4">
        {groupedQuestions.map((group) => (
          <div key={group.label}>
            {renderQuestionSection(
              `spells-${group.label.toLowerCase()}`,
              group.label,
              group.questions,
              true,
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <main
      className={
        embedded
          ? "text-slate-100"
          : "min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-3 py-4 text-slate-100 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
      }
    >
      <div className={`${embedded ? "space-y-3" : "mx-auto max-w-7xl space-y-3 sm:space-y-4"}`}>
        {showHeading ? (
          <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/65 p-3 shadow-2xl shadow-black/40 backdrop-blur sm:p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200/90">
                {headingKicker}
              </p>
              {headingTitle.trim() ? (
                <h1 className="mt-1.5 text-xl font-semibold text-white md:text-2xl">
                  {headingTitle}
                </h1>
              ) : null}
              {headingDescription.trim() ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  {headingDescription}
                </p>
              ) : null}
              {headingFacts.length > 0 ? (
                <div className="mt-3 grid max-w-2xl gap-2 sm:grid-cols-2">
                  {headingFacts.map((fact) => (
                    <div
                      key={`${fact.label}:${fact.value}`}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-slate-400">
                        {fact.label}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-200">{fact.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {showBackLink ? (
              <Link
                href={backHref}
                className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
              >
                {backLabel}
              </Link>
            ) : null}
          </div>
          </section>
        ) : null}

        <section className="rounded-[1.5rem] border border-white/10 bg-slate-900/80 p-3 shadow-2xl shadow-black/40 backdrop-blur sm:p-4 md:p-5">
          <form className="space-y-2.5 sm:space-y-3" onSubmit={handleSubmit}>
            {!showHeading && showInlineHeaderWhenNoHero ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2">
                <div className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-200/90">
                  {headingKicker}
                </div>
                {showBackLink ? (
                  <Link
                    href={backHref}
                    className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
                  >
                    {backLabel}
                  </Link>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-2 md:gap-x-4 md:grid-cols-[minmax(0,0.46fr)_minmax(0,0.62fr)_auto] md:items-center">
              <div className="flex items-center gap-1.5">
                <label className="w-12 shrink-0 text-[11px] font-medium text-slate-300">
                  Ruleset
                </label>
                {rulesetLocked ? (
                  <div className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-2.5 py-1.5 text-sm text-white">
                    {selectedRuleset}
                  </div>
                ) : (
                  <select
                    value={selectedRuleset}
                    onChange={(event) => setSelectedRuleset(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-2.5 py-1.5 text-sm text-white outline-none transition focus:border-cyan-300/60"
                  >
                    {rulesetOptions.map((ruleset) => (
                      <option key={ruleset} value={ruleset}>
                        {ruleset}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <label
                  className="w-12 shrink-0 text-[11px] font-medium text-slate-300"
                  htmlFor="character-name"
                >
                  Name
                </label>
                <input
                  id="character-name"
                  value={characterName}
                  onChange={(event) => handleManualNameChange(event.target.value)}
                  placeholder="Required"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-2.5 py-1.5 text-sm text-white outline-none transition focus:border-cyan-300/60"
                />
              </div>

              <button
                type="submit"
                disabled={!characterName.trim() || isSubmitting || Boolean(liveValidationError)}
                className="w-full whitespace-nowrap rounded-xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto md:min-w-[124px]"
              >
                {isSubmitting
                  ? mode === "create"
                    ? submitLabelSavingCreate
                    : submitLabelSavingEdit
                  : mode === "create"
                    ? submitLabelCreate
                    : submitLabelEdit}
              </button>
            </div>

            {coachFieldBadges.name || coachLastAppliedByField.name ? (
              <div className="flex flex-wrap items-center gap-2">
                {coachFieldBadges.name ? (
                  <span className="rounded-full border border-cyan-300/35 bg-cyan-300/12 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                    {coachFieldBadges.name}
                  </span>
                ) : null}
                {coachLastAppliedByField.name ? (
                  <button
                    type="button"
                    onClick={() => handleUndoCoachApply("name", "Character Name")}
                    className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/60"
                  >
                    Undo Name Apply
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
              <aside className="space-y-2.5 rounded-xl border border-white/10 bg-black/20 p-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
                    Character Coach
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Ask for ideas and writing help. Use the action buttons to copy suggestions into
                    form fields.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Apply mode
                  </span>
                  <button
                    type="button"
                    onClick={() => setCoachApplyMode("replace")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      coachApplyMode === "replace"
                        ? "bg-cyan-300/15 text-cyan-100"
                        : "bg-slate-950/70 text-slate-400 hover:text-white"
                    }`}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoachApplyMode("append")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      coachApplyMode === "append"
                        ? "bg-cyan-300/15 text-cyan-100"
                        : "bg-slate-950/70 text-slate-400 hover:text-white"
                    }`}
                  >
                    Append
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCoachChat}
                    className="ml-auto rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-white/25 hover:text-white"
                  >
                    Clear Chat
                  </button>
                  {mode === "create" && hasRestorableDraft ? (
                    <button
                      type="button"
                      onClick={handleRestoreLastClearedDraft}
                      className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/60"
                    >
                      Restore Last Cleared Draft
                    </button>
                  ) : null}
                </div>
                <div
                  ref={coachScrollContainerRef}
                  className="max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/60 p-2.5"
                >
                  {coachMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`rounded-xl border px-3 py-2 ${
                        message.role === "assistant"
                          ? "border-cyan-300/20 bg-cyan-300/5"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {message.role === "assistant" ? "Coach" : "You"}
                      </div>
                      {message.role === "assistant" && message.warning ? (
                        <div className="mt-1 rounded-md border border-amber-300/35 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-100">
                          Response parsed safely: {message.warning}
                        </div>
                      ) : null}
                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
                        {message.content}
                      </div>
                      {message.role === "assistant" &&
                      message.suggestions &&
                      (message.suggestions.name ||
                        message.suggestions.personality ||
                        message.suggestions.background ||
                        message.suggestions.physicalDescription) ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.suggestions.name ? (
                            <button
                              type="button"
                              onClick={() =>
                                applyCoachSuggestion(
                                  "name",
                                  message.suggestions?.name ?? "",
                                  "Character Name",
                                )
                              }
                              className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                            >
                              Use as Name
                            </button>
                          ) : null}
                          {message.suggestions.personality ? (
                            <button
                              type="button"
                              onClick={() =>
                                applyCoachSuggestion(
                                  "personality",
                                  message.suggestions?.personality ?? "",
                                  "Personality",
                                )
                              }
                              className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                            >
                              Use as Personality
                            </button>
                          ) : null}
                          {message.suggestions.background ? (
                            <button
                              type="button"
                              onClick={() =>
                                applyCoachSuggestion(
                                  "background",
                                  message.suggestions?.background ?? "",
                                  "Background",
                                )
                              }
                              className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                            >
                              Use as Background
                            </button>
                          ) : null}
                          {message.suggestions.physicalDescription ? (
                            <button
                              type="button"
                              onClick={() =>
                                applyCoachSuggestion(
                                  "physicalDescription",
                                  message.suggestions?.physicalDescription ?? "",
                                  "Physical Description",
                                )
                              }
                              className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                            >
                              Use as Physical
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {message.role === "assistant" &&
                      message.options &&
                      ((message.options.nameOptions?.length ?? 0) > 0 ||
                        (message.options.personalityOptions?.length ?? 0) > 0 ||
                        (message.options.backgroundOptions?.length ?? 0) > 0 ||
                        (message.options.physicalDescriptionOptions?.length ?? 0) > 0) ? (
                        <div className="mt-2 space-y-2">
                          {(message.options.nameOptions ?? []).map((option, optionIndex) => (
                            <div
                              key={`name-option-${optionIndex}`}
                              className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-2.5 py-2"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/80">
                                Name Option {optionIndex + 1}
                              </div>
                              {renderCoachOptionText(option, `${index}:name:${optionIndex}`)}
                              <button
                                type="button"
                                onClick={() => applyCoachSuggestion("name", option, "Character Name")}
                                className="mt-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                              >
                                Use this option
                              </button>
                            </div>
                          ))}
                          {(message.options.personalityOptions ?? []).map((option, optionIndex) => (
                            <div
                              key={`personality-option-${optionIndex}`}
                              className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-2.5 py-2"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/80">
                                Personality Option {optionIndex + 1}
                              </div>
                              {renderCoachOptionText(
                                option,
                                `${index}:personality:${optionIndex}`,
                              )}
                              <button
                                type="button"
                                onClick={() => applyCoachSuggestion("personality", option, "Personality")}
                                className="mt-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                              >
                                Use this option
                              </button>
                            </div>
                          ))}
                          {(message.options.backgroundOptions ?? []).map((option, optionIndex) => (
                            <div
                              key={`background-option-${optionIndex}`}
                              className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-2.5 py-2"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/80">
                                Background Option {optionIndex + 1}
                              </div>
                              {renderCoachOptionText(
                                option,
                                `${index}:background:${optionIndex}`,
                              )}
                              <button
                                type="button"
                                onClick={() => applyCoachSuggestion("background", option, "Background")}
                                className="mt-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                              >
                                Use this option
                              </button>
                            </div>
                          ))}
                          {(message.options.physicalDescriptionOptions ?? []).map(
                            (option, optionIndex) => (
                              <div
                                key={`physical-option-${optionIndex}`}
                                className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-2.5 py-2"
                              >
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/80">
                                  Physical Option {optionIndex + 1}
                                </div>
                                {renderCoachOptionText(
                                  option,
                                  `${index}:physical:${optionIndex}`,
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    applyCoachSuggestion(
                                      "physicalDescription",
                                      option,
                                      "Physical Description",
                                    )
                                  }
                                  className="mt-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/60"
                                >
                                  Use this option
                                </button>
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {isSendingCoachMessage ? (
                    <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-3 py-2">
                      <div className="h-3 w-16 animate-pulse rounded bg-cyan-200/25" />
                      <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-cyan-200/15" />
                      <div className="mt-1.5 h-2.5 w-5/6 animate-pulse rounded bg-cyan-200/15" />
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Target
                    </span>
                    <select
                      value={coachTargetMode}
                      onChange={(event) => setCoachTargetMode(event.target.value as CoachTargetMode)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60"
                    >
                      <option value="auto">Auto</option>
                      <option value="name">Name</option>
                      <option value="background">Background</option>
                      <option value="personality">Personality</option>
                      <option value="physicalDescription">Physical</option>
                    </select>
                  </label>
                  <textarea
                    value={coachInput}
                    onChange={(event) => setCoachInput(event.target.value)}
                    onKeyDown={handleCoachInputKeyDown}
                    placeholder="Ask for ideas, tone, or revisions..."
                    className="min-h-[72px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60"
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="grid gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        Quick Action
                      </span>
                      <select
                        value={coachQuickAction}
                        onChange={(event) => setCoachQuickAction(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60"
                      >
                        <option value="">Select idea/variant preset...</option>
                        <option value="name-ideas">5 name ideas</option>
                        <option value="variant-darker">3 darker variants</option>
                        <option value="variant-heroic">3 heroic variants</option>
                        <option value="variant-shorter">3 shorter variants</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={handleCoachQuickActionApply}
                      disabled={!coachQuickAction || isSendingCoachMessage}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSendCoachMessage();
                    }}
                    disabled={!coachInput.trim() || isSendingCoachMessage}
                    className="w-full rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSendingCoachMessage ? "Thinking..." : "Ask Coach"}
                  </button>
                  {coachApplyNotice ? (
                    <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1.5 text-xs text-emerald-100">
                      {coachApplyNotice}
                    </div>
                  ) : null}
                </div>
              </aside>

              <div className="min-w-0 space-y-4">
                <div className="lg:sticky lg:top-4 lg:z-20 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-slate-900/90 lg:p-2 lg:backdrop-blur">
                  <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-slate-950/70 p-1">
                    {CHARACTER_BUILDER_STEPS.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setActiveStep(step.id)}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                          activeStep === step.id
                            ? "bg-cyan-300/15 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {getBuilderStepLabel(step.id, selectedRuleset)}
                      </button>
                    ))}
                    {hasFieldErrors ? (
                      <button
                        type="button"
                        onClick={handleJumpToFirstErrorInCurrentPanel}
                        title="Jump to error"
                        aria-label="Jump to error"
                        className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/45 bg-rose-500/10 text-rose-200 transition hover:border-rose-300/80 hover:bg-rose-500/20"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 3 2.8 19a1 1 0 0 0 .87 1.5h16.66a1 1 0 0 0 .87-1.5L12 3Z" />
                          <path d="M12 9v5" />
                          <path d="M12 17.5h.01" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>

            {activeStep === "identity" ? renderQuestions(identityQuestionsForRender) : null}

            {activeStep === "description" ? renderQuestions(descriptionQuestions) : null}

            {activeStep === "stats" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {renderTabLabel("Stats & Traits", statsPanelErrorCount)}
                </div>
                {renderStatsPanel()}
              </div>
            ) : null}

            {activeStep === "spells" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {renderTabLabel("Spells & Powers", spellsPanelErrorCount)}
                </div>
                {renderSpellQuestions(spellQuestions)}
              </div>
            ) : null}

            {activeStep === "equipment" ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {renderTabLabel("Equipment", equipmentPanelErrorCount)}
                </div>
                {renderQuestions(equipmentQuestions, true)}
              </div>
            ) : null}

            {activeStep === "portrait" ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
                {expandedPreviewImage ? (
                  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 md:p-3">
                    <div className="relative h-full max-h-[96vh] w-full max-w-[96vw] rounded-lg border border-zinc-700 bg-zinc-950 p-2 md:p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-zinc-300">
                        <div className="truncate">{expandedPreviewImage.alt}</div>
                        <button
                          type="button"
                          onClick={() => setExpandedPreviewImage(null)}
                          className="rounded-md border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
                        >
                          Close
                        </button>
                      </div>
                      <div className="flex h-[calc(100%-2rem)] items-center justify-center overflow-auto rounded-md border border-zinc-800 bg-black/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={expandedPreviewImage.src}
                          alt={expandedPreviewImage.alt}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="flex items-start gap-3">
                  <div className="flex items-start gap-2">
                    <div className="relative h-28 w-28 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                      <Image
                        src={portraitDataUrl || DEFAULT_PORTRAIT_DATA_URL}
                        alt="Character portrait preview"
                        width={192}
                        height={192}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPreviewImage({
                            src: portraitDataUrl || DEFAULT_PORTRAIT_DATA_URL,
                            alt: "Character portrait preview",
                          })
                        }
                        className="absolute bottom-1 right-1 rounded-md border border-zinc-600 bg-zinc-900/90 p-1 text-zinc-100 transition hover:border-zinc-400 hover:text-white"
                        aria-label="Expand portrait preview"
                        title="Expand"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-3 w-3"
                          aria-hidden="true"
                        >
                          <path d="M9 3H3v6" />
                          <path d="M15 3h6v6" />
                          <path d="M9 21H3v-6" />
                          <path d="M15 21h6v-6" />
                          <path d="M3 3l7 7" />
                          <path d="M21 3l-7 7" />
                          <path d="M3 21l7-7" />
                          <path d="M21 21l-7-7" />
                        </svg>
                      </button>
                    </div>
                    <div className="relative h-28 w-28 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                      <Image
                        src={tokenDataUrl || DEFAULT_PORTRAIT_DATA_URL}
                        alt="Character token preview"
                        width={192}
                        height={192}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPreviewImage({
                            src: tokenDataUrl || DEFAULT_PORTRAIT_DATA_URL,
                            alt: "Character token preview",
                          })
                        }
                        className="absolute bottom-1 right-1 rounded-md border border-zinc-600 bg-zinc-900/90 p-1 text-zinc-100 transition hover:border-zinc-400 hover:text-white"
                        aria-label="Expand token preview"
                        title="Expand"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-3 w-3"
                          aria-hidden="true"
                        >
                          <path d="M9 3H3v6" />
                          <path d="M15 3h6v6" />
                          <path d="M9 21H3v-6" />
                          <path d="M15 21h6v-6" />
                          <path d="M3 3l7 7" />
                          <path d="M21 3l-7 7" />
                          <path d="M3 21l7-7" />
                          <path d="M21 21l-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-200">
                      Portrait
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Generate or upload both a portrait and a tabletop token image from your physical description.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGeneratePortrait}
                    disabled={
                      isGeneratingPortrait ||
                      typeof answers.physicalDescription !== "string" ||
                      !answers.physicalDescription.trim()
                    }
                    className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGeneratingPortrait ? "Generating..." : "Generate portrait"}
                  </button>

                  <label className="cursor-pointer rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white">
                    Upload portrait
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePortraitUpload}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateToken}
                    disabled={
                      isGeneratingToken ||
                      typeof answers.physicalDescription !== "string" ||
                      !answers.physicalDescription.trim()
                    }
                    className="rounded-xl border border-emerald-300/40 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGeneratingToken ? "Generating..." : "Generate token"}
                  </button>

                  <label className="cursor-pointer rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white">
                    Upload token
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleTokenUpload}
                    />
                  </label>
                </div>

                {partitionedQuestions.physicalDescriptionQuestion ? (
                  <CharacterQuestionField
                    question={partitionedQuestions.physicalDescriptionQuestion}
                    value={answers[partitionedQuestions.physicalDescriptionQuestion.id]}
                    errorMessage={liveFieldErrors[partitionedQuestions.physicalDescriptionQuestion.id]}
                    locked={Boolean(lockedFields[partitionedQuestions.physicalDescriptionQuestion.id])}
                    onToggleLock={() =>
                      setLockedFields((current) => ({
                        ...current,
                        [partitionedQuestions.physicalDescriptionQuestion.id]:
                          !current[partitionedQuestions.physicalDescriptionQuestion.id],
                      }))
                    }
                    onChange={(value) =>
                      handleManualFieldChange(
                        partitionedQuestions.physicalDescriptionQuestion.id,
                        value,
                      )
                    }
                    coachBadge={
                      coachFieldBadges[partitionedQuestions.physicalDescriptionQuestion.id]
                    }
                    showLockControl={isCoachLockableField(
                      partitionedQuestions.physicalDescriptionQuestion.id,
                    )}
                    canUndoCoachApply={
                      isCoachLockableField(partitionedQuestions.physicalDescriptionQuestion.id) &&
                      Boolean(
                        coachLastAppliedByField[
                          partitionedQuestions.physicalDescriptionQuestion.id as CoachFieldId
                        ],
                      )
                    }
                    onUndoCoachApply={
                      isCoachLockableField(partitionedQuestions.physicalDescriptionQuestion.id)
                        ? () =>
                            handleUndoCoachApply(
                              partitionedQuestions.physicalDescriptionQuestion.id as CoachFieldId,
                              partitionedQuestions.physicalDescriptionQuestion.label,
                            )
                        : undefined
                    }
                  />
                ) : null}
              </div>
            ) : null}

            {activeStep === "review" ? (
              <div className="space-y-4">
                {isDnd5eRuleset ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 text-sm font-medium text-slate-200">Ability Generation Summary</div>
                    <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                      <div>
                        Method:
                        {" "}
                        {dndAbilityGenerationMethod === "standard-array"
                          ? "Standard Array"
                          : dndAbilityGenerationMethod === "point-buy"
                            ? "Point Buy"
                            : dndAbilityGenerationMethod === "roll-4d6"
                              ? "Roll 4d6 Drop Lowest"
                            : "Manual Entry"}
                      </div>
                      <div>
                        Ancestry Bonus Mode:
                        {" "}
                        {dndAbilityScoreRuleSet === "modern-flexible" ? "Modern Flexible" : "Legacy Fixed"}
                      </div>
                      <div>
                        Standard Array Match:
                        {" "}
                        {dndStandardArrayMatches ? "Yes" : "No"}
                      </div>
                      <div>
                        Point Buy Spent:
                        {" "}
                        {dndPointBuySpent}
                      </div>
                      <div>
                        Point Buy Legal:
                        {" "}
                        {dndPointBuyRemaining >= 0 && dndPointBuyOutOfRangeIds.length === 0 ? "Yes" : "No"}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <button
                    type="button"
                    onClick={() => setReviewSummaryCollapsed((current) => !current)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-sm font-medium text-slate-200">Visible Summary</span>
                    <span className="text-xs text-slate-400">
                      {reviewSummaryCollapsed ? "Expand" : "Collapse"}
                    </span>
                  </button>
                  {!reviewSummaryCollapsed ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {reviewSummaryQuestions.map((question) => (
                        <div
                          key={`summary-${question.id}`}
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5"
                        >
                          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                            {question.label}
                          </div>
                          <div className="mt-1 text-sm text-slate-200">
                            {String(answers[question.id] ?? question.defaultValue ?? "Not set")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-sm text-red-200">
                {error}
              </div>
            ) : null}
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function buildDefaultAnswers(questions: CharacterQuestion[]) {
  return questions.reduce<Record<string, string | number>>((currentAnswers, question) => {
    if (question.defaultValue !== undefined) {
      currentAnswers[question.id] = question.defaultValue;
    }

    return currentAnswers;
  }, {});
}

function getCharacterBuilderDraftKey(ruleset: string) {
  const normalizedRuleset = ruleset.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `character-builder-draft:${normalizedRuleset || "default"}`;
}

function getCharacterBuilderClearedDraftKey(ruleset: string) {
  const normalizedRuleset = ruleset.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `character-builder-last-cleared:${normalizedRuleset || "default"}`;
}

function CharacterQuestionField({
  question,
  value,
  errorMessage,
  locked,
  coachBadge,
  showLockControl = true,
  canUndoCoachApply = false,
  onUndoCoachApply,
  onToggleLock,
  onChange,
}: {
  question: CharacterQuestion;
  value: string | number | undefined;
  errorMessage?: string;
  locked: boolean;
  coachBadge?: string;
  showLockControl?: boolean;
  canUndoCoachApply?: boolean;
  onUndoCoachApply?: () => void;
  onToggleLock: () => void;
  onChange: (value: string | number) => void;
}) {
  const wrapperClass =
    question.kind === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5";

  const label = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor={`field-${question.id}`} className="block text-sm font-medium text-slate-200">
          {question.label}
        </label>
        {coachBadge ? (
          <span className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-cyan-100">
            {coachBadge}
          </span>
        ) : null}
      </div>
      {showLockControl ? (
        <button
          type="button"
          onClick={onToggleLock}
          className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
            locked
              ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
              : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25 hover:text-white"
          }`}
        >
          {locked ? "Locked" : "Lock"}
        </button>
      ) : null}
      {canUndoCoachApply && onUndoCoachApply ? (
        <button
          type="button"
          onClick={onUndoCoachApply}
          className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-[11px] font-medium text-cyan-100 transition hover:border-cyan-300/70"
        >
          Undo
        </button>
      ) : null}
    </div>
  );

  if (question.kind === "select") {
    return (
      <div className={wrapperClass}>
        {label}
        <select
          id={`field-${question.id}`}
          value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-xl border bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition ${
            errorMessage
              ? "border-red-400/60 focus:border-red-300/80"
              : "border-white/10 focus:border-cyan-300/60"
          }`}
        >
          {question.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {question.helpText ? (
          <p className="text-xs text-slate-400">{question.helpText}</p>
        ) : null}
        {errorMessage ? (
          <p className="text-xs text-red-300">{errorMessage}</p>
        ) : null}
      </div>
    );
  }

  if (question.kind === "number") {
    return (
      <div className={wrapperClass}>
        {label}
        <input
          id={`field-${question.id}`}
          type="number"
          min={question.min}
          max={question.max}
          value={typeof value === "number" ? value : Number(question.defaultValue ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`w-full rounded-xl border bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition ${
            errorMessage
              ? "border-red-400/60 focus:border-red-300/80"
              : "border-white/10 focus:border-cyan-300/60"
          }`}
        />
        {question.helpText ? (
          <p className="text-xs text-slate-400">{question.helpText}</p>
        ) : null}
        {errorMessage ? (
          <p className="text-xs text-red-300">{errorMessage}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {label}
      <textarea
        id={`field-${question.id}`}
        value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
        onChange={(event) => onChange(event.target.value)}
        maxLength={question.maxLength}
        className={`min-h-[72px] w-full rounded-xl border bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition ${
          errorMessage
            ? "border-red-400/60 focus:border-red-300/80"
            : "border-white/10 focus:border-cyan-300/60"
        }`}
      />
      {question.helpText ? (
        <p className="text-xs text-slate-400">{question.helpText}</p>
      ) : null}
      {errorMessage ? (
        <p className="text-xs text-red-300">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read file."));
      }
    };

    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}


