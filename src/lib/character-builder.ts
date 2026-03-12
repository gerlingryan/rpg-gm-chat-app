import type { CharacterQuestion } from "@/lib/campaigns";

export const CHARACTER_BUILDER_STEPS = [
  { id: "identity", label: "Identity" },
  { id: "description", label: "Description" },
  { id: "stats", label: "Stats & Traits" },
  { id: "spells", label: "Spells & Powers" },
  { id: "equipment", label: "Equipment" },
  { id: "portrait", label: "Portrait" },
  { id: "review", label: "Review" },
] as const;

export type CharacterBuilderStep = (typeof CHARACTER_BUILDER_STEPS)[number]["id"];

export function isSpellQuestion(question: CharacterQuestion) {
  return /spell|cantrip|hex|miracle|favor|invention|arcanepool/i.test(question.id);
}

export function isEquipmentQuestion(question: CharacterQuestion) {
  return /(weapon|armor|gear|equipment|inventory|ammo|mainhand|offhand|shield)/i.test(
    question.id,
  );
}

export function isNotesQuestion(question: CharacterQuestion) {
  return question.kind === "textarea";
}

export function isCoreNumberQuestion(question: CharacterQuestion) {
  return question.id === "age";
}

function isMechanicsQuestion(question: CharacterQuestion) {
  const deadlandsMechanicsSelectIds = new Set([
    "traitGenerationMethod",
    "primarySkillDie",
    "secondarySkillDie",
    "skillBaseDie",
    "overridePaceEnabled",
    "overrideWindEnabled",
    "overrideGritEnabled",
  ]);
  return (
    (question.kind === "number" && !isCoreNumberQuestion(question)) ||
    deadlandsMechanicsSelectIds.has(question.id) ||
    isSpellQuestion(question) ||
    isEquipmentQuestion(question)
  );
}

export function partitionCharacterQuestions(visibleQuestions: CharacterQuestion[]) {
  const physicalDescriptionQuestion =
    visibleQuestions.find((question) => question.id === "physicalDescription") ?? null;
  const visibleQuestionsWithoutPhysicalDescription = visibleQuestions.filter(
    (question) => question.id !== "physicalDescription",
  );

  const identityQuestions = visibleQuestionsWithoutPhysicalDescription.filter(
    (question) => !isMechanicsQuestion(question) && !isNotesQuestion(question),
  );
  const descriptionQuestions = [
    ...(physicalDescriptionQuestion ? [physicalDescriptionQuestion] : []),
    ...visibleQuestionsWithoutPhysicalDescription.filter((question) => isNotesQuestion(question)),
  ];
  const mechanicsStatsQuestions = visibleQuestionsWithoutPhysicalDescription.filter(
    (question) =>
      isMechanicsQuestion(question) &&
      !isSpellQuestion(question) &&
      !isEquipmentQuestion(question),
  );
  const mechanicsSpellQuestions = visibleQuestionsWithoutPhysicalDescription.filter((question) =>
    isSpellQuestion(question),
  );
  const mechanicsEquipmentQuestions = visibleQuestionsWithoutPhysicalDescription.filter((question) =>
    isEquipmentQuestion(question),
  );

  return {
    physicalDescriptionQuestion,
    identityQuestions,
    descriptionQuestions,
    mechanicsStatsQuestions,
    mechanicsSpellQuestions,
    mechanicsEquipmentQuestions,
  };
}

export function getBuilderStepLabel(step: CharacterBuilderStep, ruleset: string) {
  void ruleset;
  return CHARACTER_BUILDER_STEPS.find((entry) => entry.id === step)?.label ?? step;
}
