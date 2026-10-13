# SayDian global public-page branding

- User requested SayDian branding and English device terminology across app descriptions, agreements and policies. The reviewed r2 documents have been published through admin. The public HTML shell and document title still used SAYDIAN Health.
- Baseline origin/main 1fa02eb95b1fc4a5fcd8cc1e0c33f14ec6bad82a, fetched before a separate worktree was created. Original imported checkouts are preserved.
- Scope: four international public HTML pages and the global legal-page title suffix only. Copy now uses SayDian; approved document contents, consent versions, endpoints, authentication/deletion behavior and other products remain unchanged.
- Verification and deployment results will be recorded below.

- Dependency install completed with bundled Node and pnpm 11.25.0. db:generate, api:docs:check, typecheck, test and build all exited 0. Root tests: 1700 passed, 23 database-only cases skipped locally. Deployment artifact Python suite passed. Builds only emitted existing bundle-size warnings.
- tools:test ran and failed one tooling case because pwsh is absent (spawnSync status null); no product assertion failed. Installing Microsoft's official PowerShell archive into the local development-tools directory for the required retry. Preserve initial log /tmp/saydian-global-brand-tools-20261014.log. Full H5 checks, CI and deployment remain pending at this checkpoint.
