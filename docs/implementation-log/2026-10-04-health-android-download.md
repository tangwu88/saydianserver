# Health Android download update — 2026-10-04

## Scope and baseline

- User narrowed the release to Android only; HarmonyOS is deferred. Keep the existing HarmonyOS download, iPhone coming-soon state, Say Ring manifest and legacy `app_update` unchanged.
- Clean main synchronized from origin, baseline `ee452e2b38d88a0601d61342e0140c2e24e9dcaf`. No App source, signing credentials, production schema or provider changes.
- Reuse the verified Health sideload QA APK from App source `291a6d7ea1973f3d100568cbe8febe349b46d1f9`: `cn.saydian.app.global`, `SAYDIAN Health`, `1.0.0 (1012)`, 68029891 bytes, SHA-256 `92a22d88e6b1f8d3f397a6f2c777b94c1079fad92a9925ad60a69fc7f9ddebf6`. Android Debug certificate verified; this is an internal test package, not Play/store/production-signing acceptance.

## Changes

- `/down` reads Health Android from the existing product-bound `global_app_update` API; other platform cards still read their unchanged legacy manifest. Independent load/error handling prevents either source from overwriting or disabling the other platform's card. Reject missing/wrong Health Android identity and invalid package metadata, without fallback to a different App.
- Backend setting is displayed as “Saydian Health 更新”. Versions, URLs and hashes remain editable; no API schema or database migration.
- Keep the generic download-page heading and identify the Android card as Saydian Health; do not relabel the old HarmonyOS package as Health.
- Add the missing `/global/down/files/` internal proxy/rewrite to the existing read-only `/down/files/` directory. No API redirects, additional storage or changed legacy downloads. Routine Actions deployment reconciles the unique managed gateway block with its existing backup, syntax-check and rollback protections.
- Installation packages remain outside Git. Create an immutable, hash-verified server copy, then publish metadata only after public download verification; keep originals and old packages.

## Verification and release

- Implementation patch initially rejected a duplicate file target; no partial changes applied. Consolidated into one file operation and retried.
- Automated page tests cover Android-only replacement, unchanged HarmonyOS/iPhone, missing Health config, wrong App identity, invalid hash, independent legacy failure and Say Ring isolation.
- Focused download tests passed 17/17. Initial focused typecheck rejected the test selector's optional capture under `noUncheckedIndexedAccess`; fixed the guarded capture, reran tests and typecheck successfully. Removed the replaced `renderManifest` helper and unused import; no unrelated cleanup.
- Serial local verification succeeded: `pnpm api:docs:check` (377 routes), `pnpm tools:test`, `pnpm typecheck`, `TMPDIR=/private/tmp pnpm test`, `pnpm build`, `git diff --check`. Runtime artifact tests passed 3/3. Existing Sass/chunk-size warnings are non-fatal; real PostgreSQL and Docker image smoke evidence must come from CI, not local claims.
- Exact original APK published as GitHub prerelease [health-android-1.0.0-build1012](https://github.com/tangwu88/saydian-app-global/releases/tag/health-android-1.0.0-build1012). GitHub asset byte size and SHA-256 match the original. Original App sources and package remain unchanged.
- Server has 25 GB free and the existing Admin downloads mount is read-only. Initial GitHub download failed with curl error 56. Retry used IPv4/HTTP 1.1 and the same owned temporary directory; a mistyped directory check exited before download and was corrected by a bounded read-only directory lookup. Destination uses version/build/hash and atomic no-overwrite hardlink, under the existing deployment lock.
- GitHub-to-server retries failed with curl 52/28. Uploaded the exact original through the existing Tencent terminal file manager instead (69 s); no image archive transfer, new credentials, cloud roles or manual service deployment. Server verified the immutable destination as 68029891 bytes, mode 444 and the original SHA-256. Public `/down/files/` HEAD returns 200 with matching length and byte-range support.
- New gateway regression initially exposed indentation-sensitive insertion. Reconciliation now locates the unique route marker independent of indentation and validates only its own route body. Repeated reconciliation, wrong-upstream and duplicate-route rejection passed; focused gateway/static tests 10/10 and shell syntax passed. Added actual-image CI coverage for full synthetic download, 206 ranges, denied writes and missing-file 404 (synthetic file only, not App installation acceptance).
- Repeated the complete serial local validation chain after the routing fix; all checks exited 0.
- Public full-file download verified at 2026-10-03T18:25:34Z: 68029891 bytes and the original SHA-256. Range `0-1023` returned 206 and `Content-Range: bytes 0-1023/68029891`.

## Post-push publication gates

- Push main through the existing automatic CI/GHCR/digest pipeline; no server-side build or manual image transfer. CI must pass actual Docker image startup and the new synthetic file checks. Require both health aliases to return the pushed revision.
- After the new `/global/down/files/` route returns the same verified bytes/range, publish `global_app_update` via the authenticated admin editor. Publish only the Android destination; mandatory Health iPhone/HarmonyOS entries are non-downloadable placeholders, never used by the unchanged `/down` iPhone/HarmonyOS cards.
- Compare complete legacy `app_update` and Say Ring public manifests with the pre-change snapshots; inspect `/down` for Health Android `1.0.0（1012）`, legacy HarmonyOS `0.1.4（8）` and disabled iPhone. Current deployment status is evidenced by Actions and the live revision/configuration, not frozen in this pre-deployment source log.
- Do not claim an iOS, HarmonyOS, Play or real-device release from this update. All original App/package/signing material, prior downloads and business settings are retained.
