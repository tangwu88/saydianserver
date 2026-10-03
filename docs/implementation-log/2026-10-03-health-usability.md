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

### Refreshed main and live content correction — 2026-10-04

- Scoped care/private ECG source now sits atop main 53a2bde on codex/health-usability-20261003. Preserved the original branch as a recoverable checkpoint. Resolved conflicts by retaining all upstream admin locale transaction, editor and tests; removed the redundant local locale tests. Focused refreshed-main cases 33/33, root typecheck/build and 377-route docs check passed.
- Full refreshed-main Windows API tests: 963 passed, 7 skipped, the same 3 unchanged local-avatar filesystem failures. Earlier tools suite 27/36 with 9 existing Windows/POSIX failures; all H5 flows/contracts independently passed. Own commit remains local pending permission to publish into the public server repository; no actual Linux CI/image/readiness acceptance claimed.
- Existing main 53a2bde deployment attempt 37134577995 failed at the constrained SSH receiver. Read-only production container label still 36197ef. Did not retry or override another task's release, change deployment gates, or install the new phone package ahead of compatibility deployment.
- User-approved plan specifically requires correcting the original Chinese encyclopedia rows without replacing IDs. Verified category fb4ff2cf-f1c5-4ae3-b3fb-85de596c4a87 had exactly the three approved articles, no parent and no child categories. Original body SHA256 and publishedAt matched every pinned original. Private full content backup on existing server: /home/ubuntu/saydian-health-usability-20261003-content-backup.json, 21354 bytes, mode 600; never copied into Git.
- One scoped Prisma transaction took the same content:locale advisory lock, rechecked exact IDs/scope/language/hashes/publish times, updated only locale on one category and three articles to zh-Hans, then asserted original hashes and publish times unchanged before commit. All four rows changed atomically; no copies, no invented正文, no change to English help category or unrelated draft. This supersedes the earlier independent task's tentative plan to create Chinese copies.
- Actual global public API now returns one Chinese encyclopedia category and exactly three Chinese articles with original IDs. Each detail body hash and publishedAt match the original. Existing real Android Debug App read the same category/list and all three details through its own API client; 4044, 6255 and 2 characters respectively, with identical body hashes. This is real mobile transport acceptance, not new-package ECG/charging or rendered page acceptance. All three articles have no cover and no img element; no image acceptance fabricated. Heart-rate article remains content pending.
- Sanitized evidence outside Git: validation/usability-20261003/encyclopedia-live-acceptance.json, phone-encyclopedia-api.json, phone-encyclopedia-detail.json and encyclopedia-originals-zh-Hans.png. Independent owned cloud terminal closed; user terminal left untouched. Logged-in admin shows original three rows with zh-Hans.

### Publication authorization — 2026-10-04

- User explicitly confirmed publication and removed the private-repository prerequisite for source upload. Previous pending-publication statements above are historical and superseded. Publish this scoped branch through PR checks, then the existing main CI/image/deployment gates; preserve phone data on installation after compatible backend acceptance.
- Separate deployment repair PR #22 is in progress. Do not merge its source into this health branch or bypass its release gates. Linux CI must settle the recorded Windows-only failures before this health PR merges.