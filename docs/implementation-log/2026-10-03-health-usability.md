# Health usability interfaces — 2026-10-03

- Authorized scope: permission-scoped member health summary, date-range shared health records with ECG metadata, private owner/care ECG read endpoints, and explicit article/category locale editing/validation. Keep the existing global mount and backward-compatible record contracts.
- Baseline 48886e2, fetched origin/main ahead/behind 1/0, clean checkout. Existing local W8 acceptance documentation preserved. No schema migration, invented health records, provider credentials or private storage policy changes.
- Expected: every shared metric and waveform checked against active, unexpired relationship/permission and subject ownership; file content served through authenticated routes, never public ECG URLs. Article locale corrections preserve IDs/body/publish time and affect only the verified Chinese encyclopedia category/articles.

## Validation

- In progress. Record every check/failure/correction and deployment revision here. No online deployment or business acceptance claimed yet.

### Local implementation checks

- Flutter API counterparts and server focused cases: 20/20 passed. Root typecheck/build passed. Generated API catalog 377 routes, docs check passed; H5 flows 61/61 and H5 contracts 38/38 passed.
- Full Windows root test: API 946 passed, 7 skipped, 3 failed in unchanged Say Ring server-local avatar filesystem tests. Root tools:test: existing POSIX permission/offline receiver cases fail on Windows; separately completed all H5 suites. No Linux/real PostgreSQL or actual image acceptance inferred from these checks.
- Initial new controller constructor test and required API route explanations were corrected, then typecheck/focused/docs checks passed. No unrelated avatar/deploy implementation changed.
- Refreshed main advanced from 36197ef to 53a2bde with independently merged content-locale fix #21. Reuse that stronger locale transaction/validation/editor implementation; do not overwrite it with this task's earlier equivalent patch. Preserve original local branch and integrate only this task's care/private ECG commit onto refreshed main.
- Source publication is pending the user's answer because current server repository is public; App repository remains private. No credentials or real clinical data in source/test logs.
