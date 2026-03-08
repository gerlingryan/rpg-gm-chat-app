"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
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

const BUILDER_STEPS = [
  { id: "core", label: "Core" },
  { id: "stats", label: "Stats" },
  { id: "spells", label: "Spells" },
  { id: "equipment", label: "Equipment" },
  { id: "review", label: "Review" },
] as const;

type BuilderStep = (typeof BUILDER_STEPS)[number]["id"];

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
};

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
}: LibraryCharacterBuilderProps) {
  const router = useRouter();
  const [selectedRuleset, setSelectedRuleset] = useState(initialRuleset);
  const [characterName, setCharacterName] = useState(initialName);
  const [characterConcept, setCharacterConcept] = useState("");
  const [suggestionStyle, setSuggestionStyle] = useState<"story-first" | "rules-first">("story-first");
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [activeStep, setActiveStep] = useState<BuilderStep>("core");
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState("");
  const [suggestionNote, setSuggestionNote] = useState("");
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

    setAnswers(buildDefaultAnswers(questions));
    setLockedFields({});
  }, [questions, rulesetLocked]);

  const portraitDataUrl =
    typeof answers.portraitDataUrl === "string" &&
    answers.portraitDataUrl.startsWith("data:image/")
      ? answers.portraitDataUrl
      : "";
  const physicalDescriptionQuestion =
    visibleQuestions.find((question) => question.id === "physicalDescription") ?? null;
  const visibleQuestionsWithoutPhysicalDescription = visibleQuestions.filter(
    (question) => question.id !== "physicalDescription",
  );
  const coreQuestions = visibleQuestionsWithoutPhysicalDescription.filter(
    (question) => !isMechanicsQuestion(question) && !isNotesQuestion(question),
  );
  const statsQuestions = visibleQuestionsWithoutPhysicalDescription.filter(
    (question) => question.kind === "number" && !isCoreNumberQuestion(question),
  );
  const spellQuestions = visibleQuestionsWithoutPhysicalDescription.filter((question) =>
    isSpellQuestion(question),
  );
  const equipmentQuestions = visibleQuestionsWithoutPhysicalDescription.filter((question) =>
    isEquipmentQuestion(question),
  );
  const reviewQuestions = visibleQuestionsWithoutPhysicalDescription.filter((question) =>
    isNotesQuestion(question),
  );

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
      const response = await fetch(submitUrl, {
        method: submitMethod,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: characterName.trim(),
          ...(mode === "create" ? { ruleset: selectedRuleset } : {}),
          answers,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.character?.id) {
        throw new Error(
          data.error ??
            (mode === "create"
              ? "Unable to create library character."
              : "Unable to update library character."),
        );
      }

      if (mode === "create") {
        router.push(
          `${returnTo}?ruleset=${encodeURIComponent(selectedRuleset)}&libraryCharacterId=${encodeURIComponent(data.character.id)}`,
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

  async function handleSuggest(mode: "draft") {
    const trimmedConcept = characterConcept.trim();

    if (!trimmedConcept || isSuggesting) {
      return;
    }

    setError("");
    setSuggestionNote("");
    setIsSuggesting(true);

    try {
      const response = await fetch("/api/library-characters/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
            ruleset: selectedRuleset,
            concept: trimmedConcept,
            style: suggestionStyle,
            mode,
            answers,
          lockedFieldIds: Object.entries(lockedFields)
            .filter(([, locked]) => locked)
            .map(([fieldId]) => fieldId),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.answers || typeof data.answers !== "object") {
        throw new Error(data.error ?? "Unable to apply AI suggestions.");
      }

      setAnswers((currentAnswers) => ({
        ...currentAnswers,
        ...data.answers,
      }));
      setActiveStep(getStepForSuggestionMode(mode));
      setSuggestionNote(
        typeof data.rationale === "string" && data.rationale.trim()
          ? data.rationale
          : "Applied AI suggestions to the unlocked visible fields.",
      );
    } catch (suggestionError) {
      setError(
        suggestionError instanceof Error
          ? suggestionError.message
          : "Unable to apply AI suggestions.",
      );
    } finally {
      setIsSuggesting(false);
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
              setAnswers((currentAnswers) => ({
                ...currentAnswers,
                [question.id]: value,
              }))
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
                    setAnswers((currentAnswers) => ({
                      ...currentAnswers,
                      [question.id]: value,
                    }))
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(155,231,255,0.12),_transparent_32%),linear-gradient(135deg,_#08111f_0%,_#101b31_45%,_#170f22_100%)] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
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

            <Link
              href={backHref}
              className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:text-white"
            >
              {backLabel}
            </Link>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
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

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-200">
                  Character concept
                </label>
                <textarea
                  value={characterConcept}
                  onChange={(event) => setCharacterConcept(event.target.value)}
                  placeholder="Describe the character's vibe, combat style, background, and what makes them memorable."
                  className="min-h-[112px] w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/60"
                />
                <p className="text-xs text-slate-400">
                  AI suggestions only update the visible unlocked fields. Lock any field you want to keep unchanged before you run a suggestion.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.14em] text-slate-500">
                    AI style
                  </span>
                  <button
                    type="button"
                    onClick={() => setSuggestionStyle("story-first")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      suggestionStyle === "story-first"
                        ? "bg-cyan-300/15 text-cyan-100"
                        : "bg-slate-950/70 text-slate-400 hover:text-white"
                    }`}
                  >
                    Story-first
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestionStyle("rules-first")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      suggestionStyle === "rules-first"
                        ? "bg-cyan-300/15 text-cyan-100"
                        : "bg-slate-950/70 text-slate-400 hover:text-white"
                    }`}
                  >
                    Rules-first
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSuggest("draft")}
                  disabled={!characterConcept.trim() || isSuggesting}
                  className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSuggesting ? "Thinking..." : "Draft Character"}
                </button>
              </div>

              {suggestionNote ? (
                <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
                  {suggestionNote}
                </div>
              ) : null}
            </div>

            <div className="inline-flex flex-wrap rounded-2xl border border-white/10 bg-slate-950/70 p-1">
              {BUILDER_STEPS.map((step) => (
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

            {activeStep === "core" ? renderQuestions(coreQuestions) : null}

            {activeStep === "stats" ? renderQuestions(statsQuestions) : null}

            {activeStep === "spells" ? renderSpellQuestions(spellQuestions) : null}

            {activeStep === "equipment" ? renderQuestions(equipmentQuestions) : null}

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

                  {physicalDescriptionQuestion ? (
                    <CharacterQuestionField
                      question={physicalDescriptionQuestion}
                      value={answers[physicalDescriptionQuestion.id]}
                      errorMessage={liveFieldErrors[physicalDescriptionQuestion.id]}
                      locked={Boolean(lockedFields[physicalDescriptionQuestion.id])}
                      onToggleLock={() =>
                        setLockedFields((current) => ({
                          ...current,
                          [physicalDescriptionQuestion.id]: !current[physicalDescriptionQuestion.id],
                        }))
                      }
                      onChange={(value) =>
                        setAnswers((currentAnswers) => ({
                          ...currentAnswers,
                          [physicalDescriptionQuestion.id]: value,
                        }))
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
            <button
              type="submit"
              disabled={!characterName.trim() || isSubmitting || Boolean(liveValidationError)}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? mode === "create"
                  ? "Saving character..."
                  : "Saving changes..."
                : mode === "create"
                  ? "Save to Character Library"
                  : "Save Character Changes"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function isSpellQuestion(question: CharacterQuestion) {
  return /spell|cantrip|hex|miracle|favor|invention|arcanepool/i.test(question.id);
}

function isEquipmentQuestion(question: CharacterQuestion) {
  return /(weapon|armor|gear|equipment|inventory|ammo|mainhand|offhand|shield)/i.test(
    question.id,
  );
}

function isNotesQuestion(question: CharacterQuestion) {
  return question.kind === "textarea";
}

function isCoreNumberQuestion(question: CharacterQuestion) {
  return question.id === "age";
}

function isMechanicsQuestion(question: CharacterQuestion) {
  return (
    (question.kind === "number" && !isCoreNumberQuestion(question)) ||
    isSpellQuestion(question) ||
    isEquipmentQuestion(question)
  );
}

function getStepForSuggestionMode(
  mode: "draft" | "identity" | "stats" | "spells" | "equipment" | "notes",
): BuilderStep {
  if (mode === "identity") {
    return "core";
  }

  if (mode === "stats") {
    return "stats";
  }

  if (mode === "spells") {
    return "spells";
  }

  if (mode === "equipment") {
    return "equipment";
  }

  if (mode === "notes") {
    return "review";
  }

  return "core";
}

function getBuilderStepLabel(step: BuilderStep, ruleset: string) {
  if (step === "spells" && ruleset.trim().toLowerCase() === "deadlands classic") {
    return "Hexes";
  }

  return BUILDER_STEPS.find((entry) => entry.id === step)?.label ?? step;
}

function buildDefaultAnswers(questions: CharacterQuestion[]) {
  return questions.reduce<Record<string, string | number>>((currentAnswers, question) => {
    if (question.defaultValue !== undefined) {
      currentAnswers[question.id] = question.defaultValue;
    }

    return currentAnswers;
  }, {});
}

function CharacterQuestionField({
  question,
  value,
  errorMessage,
  locked,
  onToggleLock,
  onChange,
}: {
  question: CharacterQuestion;
  value: string | number | undefined;
  errorMessage?: string;
  locked: boolean;
  onToggleLock: () => void;
  onChange: (value: string | number) => void;
}) {
  const wrapperClass =
    question.kind === "textarea" ? "space-y-2 sm:col-span-2" : "space-y-2";

  const label = (
    <div className="flex items-center justify-between gap-3">
      <label className="block text-sm font-medium text-slate-200">
        {question.label}
      </label>
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
