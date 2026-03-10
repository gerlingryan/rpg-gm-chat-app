"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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
};

type CoachChatMessage = {
  role: "user" | "assistant";
  content: string;
  warning?: string;
  suggestions?: {
    personality?: string;
    background?: string;
    physicalDescription?: string;
  };
  options?: {
    personalityOptions?: string[];
    backgroundOptions?: string[];
    physicalDescriptionOptions?: string[];
  };
};

type CoachFieldId = "personality" | "background" | "physicalDescription";
type CoachTargetMode = "auto" | CoachFieldId;

function isCoachLockableField(fieldId: string) {
  return (
    fieldId === "personality" ||
    fieldId === "background" ||
    fieldId === "physicalDescription"
  );
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
  submitBodyBuilder,
  onSubmitSuccess,
  redirectOnSuccess = true,
  showBackLink = true,
  submitLabelCreate = "Save to Character Library",
  submitLabelEdit = "Save Character Changes",
  submitLabelSavingCreate = "Saving character...",
  submitLabelSavingEdit = "Saving changes...",
  embedded = false,
  showHeading = true,
}: LibraryCharacterBuilderProps) {
  const router = useRouter();
  const [selectedRuleset, setSelectedRuleset] = useState(initialRuleset);
  const [characterName, setCharacterName] = useState(initialName);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [activeStep, setActiveStep] = useState<CharacterBuilderStep>("identity");
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isSendingCoachMessage, setIsSendingCoachMessage] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [coachApplyNotice, setCoachApplyNotice] = useState("");
  const [coachApplyMode, setCoachApplyMode] = useState<"replace" | "append">("replace");
  const [coachTargetMode, setCoachTargetMode] = useState<CoachTargetMode>("auto");
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

  const portraitDataUrl =
    typeof answers.portraitDataUrl === "string" &&
    answers.portraitDataUrl.startsWith("data:image/")
      ? answers.portraitDataUrl
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
  const activeStepQuestionIds = useMemo(() => {
    if (activeStep === "identity") {
      return identityQuestions.map((question) => question.id);
    }
    if (activeStep === "description") {
      return descriptionQuestions.map((question) => question.id);
    }
    if (activeStep === "mechanics") {
      return [...statsQuestions, ...spellQuestions, ...equipmentQuestions].map(
        (question) => question.id,
      );
    }
    return visibleQuestions.map((question) => question.id);
  }, [
    activeStep,
    descriptionQuestions,
    equipmentQuestions,
    identityQuestions,
    spellQuestions,
    statsQuestions,
    visibleQuestions,
  ]);
  const stepHasErrors = activeStepQuestionIds.some((questionId) =>
    Boolean(liveFieldErrors[questionId]),
  );
  const reviewQuestions = useMemo(
    () =>
      descriptionQuestions.filter((question) => question.id !== "physicalDescription"),
    [descriptionQuestions],
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
    if (lockedFields[fieldId]) {
      setCoachApplyNotice(`${label} is locked. Unlock it to apply coach suggestions.`);
      return;
    }
    const previousValue = answers[fieldId];
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldId]:
        coachApplyMode === "append" && typeof currentAnswers[fieldId] === "string"
          ? `${currentAnswers[fieldId]}`.trim()
            ? `${currentAnswers[fieldId]}\n\n${value}`
            : value
          : value,
    }));
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

  function handleManualFieldChange(fieldId: string, value: string | number) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldId]: value,
    }));
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
        delete next[fieldId as CoachFieldId];
        return next;
      });
    }
  }

  function handleUndoCoachApply(fieldId: CoachFieldId, label: string) {
    const lastApply = coachLastAppliedByField[fieldId];
    if (!lastApply) {
      return;
    }
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldId]:
        typeof lastApply.previous === "number"
          ? lastApply.previous
          : typeof lastApply.previous === "string"
            ? lastApply.previous
            : "",
    }));
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
          `${returnTo}?ruleset=${encodeURIComponent(selectedRuleset)}&libraryCharacterId=${encodeURIComponent(characterId)}`,
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

  function renderQuestions(questionList: CharacterQuestion[]) {
    if (questionList.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
          No fields are active for this step yet.
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-2">
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
      return renderQuestions(questionList);
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
          <div
            key={group.label}
            className="rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {group.label}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {group.questions.map((question) => (
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
      <div className={`${embedded ? "space-y-4" : "mx-auto max-w-5xl space-y-4 sm:space-y-6"}`}>
        {showHeading ? (
          <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200/90">
                {headingKicker}
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                {headingTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                {headingDescription}
              </p>
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

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-6 md:p-8">
          <form className="space-y-4 sm:space-y-6" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-200">
                  RPG ruleset
                </label>
                {rulesetLocked ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white">
                    {selectedRuleset}
                  </div>
                ) : (
                  <select
                    value={selectedRuleset}
                    onChange={(event) => setSelectedRuleset(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                  >
                    {rulesetOptions.map((ruleset) => (
                      <option key={ruleset} value={ruleset}>
                        {ruleset}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label
                  className="block text-sm font-medium text-slate-200"
                  htmlFor="character-name"
                >
                  Character name
                </label>
                <input
                  id="character-name"
                  value={characterName}
                  onChange={(event) => setCharacterName(event.target.value)}
                  placeholder="Required"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-300">
              Step through Identity, Description, Mechanics, and Review. The form fields are the
              source of truth for saved character data.
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)]">
              <aside className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
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
                  className="max-h-[520px] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/60 p-3"
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
                      (message.suggestions.personality ||
                        message.suggestions.background ||
                        message.suggestions.physicalDescription) ? (
                        <div className="mt-2 flex flex-wrap gap-2">
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
                      ((message.options.personalityOptions?.length ?? 0) > 0 ||
                        (message.options.backgroundOptions?.length ?? 0) > 0 ||
                        (message.options.physicalDescriptionOptions?.length ?? 0) > 0) ? (
                        <div className="mt-2 space-y-2">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Target
                    </span>
                    {([
                      { id: "auto", label: "Auto" },
                      { id: "background", label: "Background" },
                      { id: "personality", label: "Personality" },
                      { id: "physicalDescription", label: "Physical" },
                    ] as const).map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => setCoachTargetMode(target.id)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          coachTargetMode === target.id
                            ? "bg-cyan-300/15 text-cyan-100"
                            : "bg-slate-950/70 text-slate-400 hover:text-white"
                        }`}
                      >
                        {target.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={coachInput}
                    onChange={(event) => setCoachInput(event.target.value)}
                    onKeyDown={handleCoachInputKeyDown}
                    placeholder="Ask for ideas, tone, or revisions..."
                    className="min-h-[88px] w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/60"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCoachVariantRequest("darker")}
                      disabled={isSendingCoachMessage}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                    >
                      3 darker variants
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCoachVariantRequest("heroic")}
                      disabled={isSendingCoachMessage}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                    >
                      3 heroic variants
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCoachVariantRequest("shorter")}
                      disabled={isSendingCoachMessage}
                      className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1 text-xs text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-50"
                    >
                      3 shorter variants
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

              <div className="min-w-0 space-y-6">
                <div className="lg:sticky lg:top-4 lg:z-20 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-slate-900/90 lg:p-2 lg:backdrop-blur">
                  <div className="inline-flex flex-wrap rounded-2xl border border-white/10 bg-slate-950/70 p-1">
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
                  </div>
                </div>

            {activeStep === "identity" ? renderQuestions(identityQuestions) : null}

            {activeStep === "description" ? renderQuestions(descriptionQuestions) : null}

            {activeStep === "mechanics" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Stats & Traits
                  </div>
                  {renderQuestions(statsQuestions)}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Spells & Powers
                  </div>
                  {renderSpellQuestions(spellQuestions)}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Equipment
                  </div>
                  {renderQuestions(equipmentQuestions)}
                </div>
              </div>
            ) : null}

            {activeStep === "review" ? (
              <div className="space-y-6">
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-200">
                        Portrait
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Generate a portrait from the physical description or upload your own image.
                      </p>
                    </div>

                    <div className="h-24 w-24 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                      <Image
                        src={portraitDataUrl || DEFAULT_PORTRAIT_DATA_URL}
                        alt="Character portrait preview"
                        width={192}
                        height={192}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
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

                {renderQuestions(reviewQuestions)}

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-medium text-slate-200">Current Visible Summary</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {visibleQuestions.map((question) => (
                      <div
                        key={`summary-${question.id}`}
                        className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
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
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
              <div className="text-xs text-slate-400">
                {stepHasErrors
                  ? "This step has validation issues. Resolve them before saving."
                  : "Step looks good."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActiveStep((currentStep) => {
                      const currentIndex = CHARACTER_BUILDER_STEPS.findIndex(
                        (step) => step.id === currentStep,
                      );
                      if (currentIndex <= 0) {
                        return currentStep;
                      }
                      return CHARACTER_BUILDER_STEPS[currentIndex - 1].id;
                    })
                  }
                  className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActiveStep((currentStep) => {
                      const currentIndex = CHARACTER_BUILDER_STEPS.findIndex(
                        (step) => step.id === currentStep,
                      );
                      if (currentIndex >= CHARACTER_BUILDER_STEPS.length - 1) {
                        return currentStep;
                      }
                      return CHARACTER_BUILDER_STEPS[currentIndex + 1].id;
                    })
                  }
                  className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white"
                >
                  Next
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={!characterName.trim() || isSubmitting || Boolean(liveValidationError)}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
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
    question.kind === "textarea" ? "space-y-2 sm:col-span-2" : "space-y-2";

  const label = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <label className="block text-sm font-medium text-slate-200">
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
          value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition ${
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
          type="number"
          min={question.min}
          max={question.max}
          value={typeof value === "number" ? value : Number(question.defaultValue ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition ${
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
        value={typeof value === "string" ? value : String(question.defaultValue ?? "")}
        onChange={(event) => onChange(event.target.value)}
        maxLength={question.maxLength}
        className={`min-h-[88px] w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition ${
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
