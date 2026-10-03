# Say Ring sleep AI safe diagnostics — 2026-10-03

## Scope and baseline

- Authorized joint Say Ring debugging only: explain future `sleep_ai:invalid_content` failures without exposing provider output. No Health client changes, real-report retry, consent change, model change, prompt change or database write.
- Initial production baseline `4abbcb40411df002249ef2e915295a44048bb5c6`. Refreshed main advanced to `a9481c097977d13887ac84af161f9acec9ea1cd1`; reconciled the clean isolated branch before editing. Preserve the colleague's dirty timeout log in its original worktree.
- The existing publication wrapper requires main; this isolated feature branch uses explicit staging, refreshed remote equality and the same serial validation gates, followed by PR/CI and the existing automatic production release. Do not overwrite another branch or duplicate a running deployment.

## Evidence and changes

- One explicitly synthetic minimum sleep aggregate was sent to the currently configured production provider with the current parser. HTTP 200, approximately 16.7 seconds, valid JSON, accepted by the existing parser. No real person, member, account, device or health data was sent; no report or task was created or retried. The original failed report was unchanged.
- This did not reproduce a provider-parameter or validator defect. Existing logs did not distinguish invalid envelope/JSON, missing content, metric/evidence errors, shape errors or wellness-policy rejection; do not claim the original failure was fixed or generated successfully.
- `apps/worker/src/health-report-worker.ts`: keep a local failure stage and map exact existing validator messages to fixed categories. Only the sleep invalid-content catch logs `sleep_ai_content_rejected` and a literal category; never log an error object/message, response, request, model content, identity or secret. The public/persisted `sleep_ai:invalid_content` code and retry behavior remain unchanged.
- Categories: `provider_response`, `response_json`, `empty_message`, `content_json`, `unavailable_metric`, `missing_evidence`, `content_shape`, `sleep_score_shape`, `wellness_policy`, `validation_unknown`. Unknown messages never become category values.
- Existing medical, metric, evidence and score validation is untouched. Accepted sleep results, shared Health failures, typed provider errors, truncation, timeouts and network errors do not emit the new diagnostic.
- Reuse `sleep-provider-timeout.test.ts` fixtures; synthetic sentinel tests assert the exact two safe log arguments and continued rejection. No new dependency, duplicate validator, schema migration, API contract or runtime provider call.

## Verification

- `pnpm install --frozen-lockfile`, `pnpm db:generate`, contracts build: passed in the isolated checkout.
- Test-first run: 10 expected failures because fixed-category logs did not exist; existing behavior checks remained green. After implementation, four targeted files passed 86 tests, including 16 new diagnostics/privacy/non-regression cases.
- Formatting check identified the modified test file; formatted only that file, then all three changed files passed formatting. Serial `TMPDIR=/private/tmp pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm api:docs:check`, `pnpm tools:test` and `git diff --check`: passed. API 927 passed / 7 database tests skipped locally; Worker 108 passed. API catalog: 374 fully described routes. Tooling/H5 suites: 36 + 61 + 38 passed. Existing Sass/chunk-size warnings are not concealed or unrelatedly changed.
- Reviewed final patch: 35 added runtime lines; existing validator bodies, prompts, request parameters, public error codes, retry/consent/database behavior remain unchanged. Reused fixtures instead of a second validator or diagnostic subsystem.
- A GitHub status lookup returned a transient API EOF; this is not a test/deployment result. Retry the read-only status query, without triggering another production publisher.
- Local Docker/image/database acceptance is not claimed; the existing Ubuntu CI, actual PostgreSQL, immutable runtime images and locked deployment gates must pass for the exact merged commit.

## Acceptance boundaries

- No additional live AI call or manual retry of the original report is part of this patch. Fixed logs can identify the rejection stage only for a later authorized request; a synthetic success is not real-report or phone acceptance.
- Normal main publication only after gates pass; validate Actions, both public readiness revisions and running image digests. Preserve maintenance/business flags, old data and original task state. No server build, production seed, supplier enablement, lock deletion or unrelated cleanup.
