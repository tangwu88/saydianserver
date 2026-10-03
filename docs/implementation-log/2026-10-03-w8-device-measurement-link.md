# W8 device measurement association — 2026-10-03

## Baseline and acceptance

- User reproduction: member 31's W8 device connection details show zero measurements despite actual phone/server measurements. The active device measurement endpoint returns HTTP 200 with total zero.
- Authoritative connection payload uses a routed SDK device identifier; actual locally uploaded measurement records use the corresponding native SDK identifier without the route prefix. Both are member-scoped hashed identifiers, so the existing query cannot join them.
- Source baseline: `4abbcb40411df002249ef2e915295a44048bb5c6`, matching fetched `origin/main`. A separate detached worktree preserves the existing public-pages branch and unrelated untracked files in the older checkout. Remote owner/authenticated GitHub user are `tangwu88`.
- Planned scope: device measurement query plus focused regression tests. Resolve a legacy native identifier only from the actual latest connection payload after verifying its full routed identifier hashes to the selected binding under the same member. Keep member scope, role checks, access audit, pagination and original measurement values intact. No database migration, reassignment, reupload or synthetic real-account data.
- Success: all existing real W8 member records appear on the selected device's measurement tab after a standard verified release; API count and rendered page are checked separately. Run required host checks, CI/image checks and live revision/readback; failures and unverified boundaries remain explicit.

## Companion weather report

- The user also reports unavailable weather. The currently installed Health Debug package used `config/dev.json.example`, whose `QWEATHER_API_KEY` is empty. `DeviceWeatherService` rejects the request before location access; this is an unconfigured provider, not verified location or network failure.
- No Health weather private configuration file was found in the current or original global App's `config` directories. Requested the existing private configuration path without soliciting a credential in chat. Weather service configuration and phone/watch acceptance remain separate from this server association change.

## Weather scope decision and validation before integration

- User confirmed no weather account/configuration exists, requested weather on the phone, and authorized choosing the better approach. Reading another manufacturer's system Weather App has no verified portable API. Choose App acquisition using MET Norway's public Locationforecast data through a fixed first-party cached endpoint. Official license permits use under CC BY 4.0 with attribution; provider requires identified User-Agent, expiration-aware caching and recommends a proxy for mobile clients.
- A read-only HTTPS probe inside the running production API returned HTTP 200 and 90 forecast points for public Beijing coordinates. The Windows Python probe failed certificate-chain verification; TLS was not disabled. Phone position is rounded to two decimals before transmission; endpoint does not require/account-log a member token and does not persist location. Missing/malformed/provider-error data remain errors, never invented weather.
- Added scope: public support weather route/service, bounded cache honoring Expires/Last-Modified, coordinate validation and forecast tests; App current-location display, source/license attribution and explicit separation from unverified watch writes. No new weather account, secret, schema, SDK or health changes.

## Initial device-link checks

- Dependencies installed offline with frozen lockfile; Prisma generated using local dummy configuration. Typecheck, build, API documentation check (373 routes), deployment config checks (12/12), and focused device/raw-health/reliability tests (42/42) passed.
- Full API suite: 915 passed, 7 database tests skipped, 3 existing Say Ring avatar tests failed on Windows directory fsync (EPERM verified independently; those files unchanged). Deploy tooling retry with Git Bash: 29 passed / 7 failed due Windows POSIX executable fixture/path behavior. Do not weaken unrelated tests; exact patch still requires full Linux CI and database/image checks before deployment.
- Read-only production join probe first used an unsupported memberNo field; corrected to compatibilityId. Confirmed member 31 had 22 health rows, existing selected-device query matched zero, verified native identifier alias matched 22. No database writes performed.

## Combined patch host verification and publication path

- Weather/device/raw-health/reliability focused suite: 51/51 passed. Repeated root typecheck and build passed. Generated/checked API reference: 374 fully described routes. Repeated full API suite: 924 passed, 7 local database tests skipped, same 3 unchanged avatar/fsync Windows failures. Deployment configuration suite: 12/12 passed; whitespace check passed.
- Exact descendant patch is published from the isolated checkout with an explicit file list and refreshed origin/main equality, without merging any unrelated feature branch. Windows-only failures prevent using the Windows publication wrapper's all-green gate; full Ubuntu CI, real PostgreSQL and built-image acceptance remain mandatory in the existing main workflow before automatic production deployment. No test is disabled or changed to work around host failures.
- Previous baseline main release verification passed, but receiver deployment exited 143 while pulling immutable images; live revision remained d350538. Preserve current running services and data, and inspect the new patch release independently. A successful source push is not deployment acceptance.
