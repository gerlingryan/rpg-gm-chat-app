# Character Coach QA Checklist

## Scope
- Character creation two-panel flow:
  - Left: Character Coach (advice-only)
  - Right: Character Builder stepper

## Functional Checks
1. Ask targeted request:
   - Prompt: `Give me 3 background ideas for a female dwarf cleric in Faerun`
   - Expected: background options only (no personality/physical options).
2. Ask personality request:
   - Prompt: `Give me 3 personality options for a grim gunslinger`
   - Expected: personality options only.
3. Apply mode:
   - Set `Replace`, apply an option, verify field replaced.
   - Set `Append`, apply an option, verify content appended.
   - Lock the target field and verify coach apply is blocked.
4. Field badges:
   - After apply, verify `Coach replace` or `Coach append` badge on target field.
   - Manually edit field and verify badge clears.
   - Click `Undo` and verify prior field value is restored.
5. Variant shortcuts:
   - Click `3 darker variants`, `3 heroic variants`, `3 shorter variants`.
   - Expected: coach responds with corresponding variants.
6. Enter behavior:
   - `Enter` sends message.
   - `Shift+Enter` inserts newline.
6.1 Target mode:
   - Set `Background` target and request ideas.
   - Verify only background outputs/actions are returned.
   - Repeat for `Personality` and `Physical`.
7. Clear chat:
   - Click `Clear Chat`, verify messages reset to starter assistant message.
8. Restore last cleared draft:
   - Create mode only.
   - Save a character once, return to create screen, click `Restore Last Cleared Draft`.
   - Verify name + answers restore for the same ruleset.
9. Form integrity:
   - Saving character still works for create and edit flows.
10. Coach quality retry:
   - Try prompts that previously returned generic intros only.
   - Verify concrete options/suggestions are returned.
11. Malformed response fallback:
   - Temporarily force malformed coach payload (or simulate API failure).
   - Verify assistant still renders a safe fallback message and no runtime crash.
   - Verify notice explains partial/malformed response handling.

## Ruleset Checks
1. D&D 5e:
   - Verify steps and labels render correctly.
   - Verify spell/equipment sections still render in Mechanics.
2. Deadlands Classic:
   - Verify step labels and questions render correctly.
   - Verify mechanics section still includes traits/powers/equipment as expected.

## Regression Checks
1. Portrait generate/upload still works.
2. Validation errors still block submit.
3. Back/Next step navigation still works.
4. Logs show `[character-coach]` (server) and `[character-coach-client]`/`[character-coach-apply]` (client) events.

## Campaign Main Character Smoke
1. In a campaign with no main character, verify the shared guided builder appears.
   - Dev shortcut: use gear menu `DEV: Clear Main Character` on an existing campaign.
2. Complete steps and submit:
   - Expected: main character is created and appears in campaign character list.
   - Expected: character generation panel is replaced by normal campaign UI.
3. Portrait in campaign flow:
   - Generate portrait from physical description.
   - Upload a portrait file.
   - Verify saved portrait appears in character card.
4. Ruleset lock:
   - Verify ruleset is fixed to campaign ruleset in this flow.

## Automated Tests
1. Run `pnpm test:coach` for coach helper parsing/normalization coverage.
2. Run `pnpm test:combat` for deterministic combat fixtures and fuzz transitions.
3. Run `pnpm test:campaign` for main-character merge behavior.
4. Run `pnpm test:lib` to run all suites.

## Release Readiness
1. Run `pnpm lint`.
2. Run `pnpm test:lib`.
3. Execute Campaign Main Character Smoke and Functional Checks 1-5 at minimum.
