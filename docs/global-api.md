# Saydian international API foundation

Status: international API deployed on the independent global instance for pre-release QA. The `/admin/` frontend is international-only and uses the global database and independent administrator sessions. Domestic consumer accounts and data are not imported. Real email/SMS delivery and other disabled providers remain unverified; see the dated implementation logs for deployment evidence.

## Routing and account boundary

The application host is `https://app.saydian.cn`. The international API base is `https://app.saydian.cn/global/api/saydian-app/v2`; a static gateway removes `/global` and forwards to a dedicated global service. A header, cookie, device name, UI language, or client-supplied realm cannot switch accounts.

The process uses `APP_REALM=global`, independent database, Redis, queue, storage bucket and credentials. Access tokens use issuer `saydian-global-server` and audience `saydian-global-app`. The legacy imported-session bridge and domestic OTP/WeChat registration paths are disabled. Domestic deployments retain their previous routes, claims and China mobile handling. No domestic account migration is included.

Success is the existing V2 envelope `{code:200,message:"OK",data:...,timestamp,requestId}`. A POST may return HTTP 201 while the envelope code remains 200. Global errors have an English message and, for new failures, an `errorKey`; clients translate the key rather than displaying implementation details. UUIDs must remain strings. Existing authenticated V1 business adapters operate only on the same global service/database; they do not grant access to domestic accounts.

## Authentication contract

Locales are `en`, `zh-Hans`, `zh-Hant`, `de`, `fr`, `es`, `ja`, `ko`; default is English. Language does not determine country, currency, identity or SMS availability.

| Method / V2 path | Request | `data` |
| --- | --- | --- |
| GET `/auth/capabilities?locale=en` | Optional locale | `{realm:"global",defaultLocale:"en",supportedLocales,registration:{email,sms,verificationRequired},recovery:{email,sms},smsCountries:string[],verification:{codeLength:6,expiresIn:300,retryAfter:60},consentVersion:string|null,legal:LegalLinks|null}` |
| POST `/auth/register` | `{channel:"email"\|"sms",identifier,password,nickname?,consentVersion,locale?}` | Temporary unverified `Session`; available only while `GLOBAL_UNVERIFIED_REGISTRATION_ENABLED=true` |
| POST `/auth/verification-code` | `{channel:"email"\|"sms",identifier,purpose:"register"\|"reset_password",locale?}` | `{challengeId,expiresIn:300,retryAfter:60,maskedIdentifier}`; never returns the code |
| POST `/auth/register-with-code` | `{challengeId,code,password,nickname?,consentVersion,locale?}` | `Session` |
| POST `/auth/login` | `{channel,identifier,password}` | `Session` |
| POST `/auth/reset-password` | `{challengeId,code,password}` | Fresh `Session`; existing sessions revoked |
| POST `/auth/refresh` | `{refreshToken}` | Rotated `Session`; serialize refresh calls |
| POST `/auth/logout` | Existing authenticated route | `{loggedOut:true}` |

`Session = {accessToken,refreshToken,expiresAt:ISO_UTC,member}`. Member is a UUID profile with nickname, optional avatar, gender, birthday, height/weight and masked email/phone plus locale. Raw identifiers, password hashes, OTPs and credentials are not returned. `mobile`/`username` remain compatibility aliases on password login; international callers should use the explicit new fields.

Use `registration` only for new accounts and `recovery` for password-reset verification. `registration.verificationRequired=false` means the explicitly enabled temporary registration route does not send or accept a verification code. Such accounts retain a null email/mobile verification timestamp, and verified-contact commerce guards remain closed. Recovery still depends on an independently verified delivery channel and write-maintenance state; its SMS flow uses the actual `smsCountries` allowlist. Existing verified-account password login does not require new registration capabilities or a newly published consent version. Temporary unverified accounts can sign in and refresh only while the same feature flag remains enabled. Signing in alone does not authorize push/privacy-dependent features.

Email is trimmed and normalized; the domain supports IDN, and canonical email is case-insensitive. SMS identities must be valid E.164 numbers (including `+` country calling code), validated using `libphonenumber-js/max`; local-only numbers or extensions are rejected. Verified registration stores a verification timestamp. The temporary unverified route stores the normalized identifier without a verification timestamp and does not claim message delivery. No device-name/model-specific identity rule exists.

Passwords require at least 8 characters and at most 72 UTF-8 bytes (bcrypt limit). Nickname is at most 40 characters. Challenges expire after 5 minutes, allow at most 5 wrong attempts, are single-use and purpose-bound. Recipient cooldown is 60 seconds across purposes, with at most 10 requests per 24 hours; controller IP throttles also apply. Failed deliveries cannot be consumed. Tests use synthetic, mocked delivery only.

`LegalLinks = {userAgreement:{path,locale,version},privacyPolicy:{path,locale,version}}`. Paths are API-relative, for example `/api/saydian-app/v2/content/legal/user_agreement?version=<published>&locale=en`; add the international gateway prefix exactly once. Public GET returns a reviewed document containing `contentHtml`. Only matching, published, reviewed terms/privacy versions enable registration, including the temporary unverified route; requested-language documents may explicitly fall back to English via their returned locale. With no documents, `consentVersion` and `legal` are null and registration stays false. Do not invent a version or skip displaying these documents. Paused business writes also keep registration false.

## Other client contracts

- Display numbers: international sessions and `/members/me` return `memberNo`, a positive decimal string backed by the existing unique `User.compatibilityId`. `promo_code` is a same-value display alias for released international App “My” screens, not a promotion attribution code. Existing users already have this number; no ID migration or re-registration is required. `id` and token subject remain UUIDs and continue to identify private data and account caches.
- The `/admin/` frontend serves the international system exclusively: its management requests use `/global/api/saydian-app/admin/v1` and the global database, administrator accounts and sessions. There is no domestic/international data selector. Lists include numeric `memberNo` and masked email, with server-side email/number search and pagination.
- For admin `/members/:id/health-records`, international SUPER_ADMIN may omit `reason`; HEALTH_AUDITOR still supplies 5–300 characters, and other roles remain forbidden. The effective roles come from the authenticated database session, never query claims. Every successful raw read still requires a persisted `HEALTH_RAW_READ` audit with actor, target, timestamp, request ID and record count; an omitted super-admin reason is explicitly system-labelled with `reasonSource: "SUPER_ADMIN_EXEMPTION"`, not fabricated as a user-provided purpose. Audit write failure prevents returning the records. Domestic reason policy is unchanged.
- Admin category lists and create/update responses include read-only `categoryNo`, a stable positive decimal string (for example `"12"`). The existing technical sequence table uses the isolated `global_article_category` namespace; missing numbers are assigned once, without changing the schema or legacy IDs. Concurrent allocation is deduplicated; numbers may have gaps and do not change with name/order/status. `id`, `parentId`, article `categoryId` and update URLs remain UUIDs. The admin displays category names/numbers in selectors and submits their UUIDs; client-supplied `categoryNo` cannot change the number. App content responses and domestic endpoints are unchanged.

- GET/PUT `/members/me`: existing profile contract; PUT may update `locale`. GET/PUT `/members/me/goals`: `{steps:number|null,distanceMeters:number|null,caloriesKcal:number|null}`. Unknown goals remain null, never fabricated zero.
- POST `/care/invitations`: `{identifier:email|E.164}` (`mobile` compatibility alias). Existing relationship UUIDs, ownership and per-metric authorization remain unchanged. It only finds accounts in the global database; this is an in-app invitation, not an email invitation delivery service.
- Health upload and push installation contracts now accept `harmony` alongside Android/iOS. Existing evidence and health algorithms are unchanged.
- V2 POST `/health/records/batch` retains each original record ID and timestamp, numeric `timezoneOffsetMinutes`, unchanged `values`, and `source:{platform,deviceId?,model?,firmware?,origin?,measurementSource?,rawVersion?}`. Optional capture metadata is stored separately, never inside metric values: origin is `watch_history|app_measurement|remote_member|manual_entry|imported|unknown`, measurementSource is `wearable|manual|imported`, rawVersion is a positive integer. Older requests/rows keep these fields absent; no inferred device origin is added. List responses return provided metadata. A reused record ID with changed metadata is a conflict, not an overwrite. Clients must validate `acceptedIds` against submitted IDs and leave omitted/rejected records queued. ECG waveforms require a real sample rate and verified upload artifact; do not upload a waveform-less summary and claim the whole original record synchronized.
- GET `/health/profile` includes global `analysisConsent.availableVersion:string|null` and `analysisConsent.document:{path,locale,version}|null`, from a reviewed `health_ai_analysis` document. POST `/health/profile/analysis-consent` accepts `{granted:true,version,locale?}` only against the current published version. With no reviewed document, granting is unavailable; `{granted:false}` still withdraws consent. Existing reports/evidence remain owned by the user.
- POST `/health/reports/:id/retry` independently checks current analysis consent before updating or requeueing a failed global report. Missing/withdrawn consent returns 403 `analysis_consent_required`; missing or replaced reviewed documents return 409 `consent_outdated`. Client-side checks do not replace this server boundary.
- POST `/ai/messages` accepts `locale`; chosen language is stored on the conversation and applied to the provider system prompt. Existing wellness/no-diagnosis/no-invented-data instructions remain. Conversation language precedes account language if no new locale is supplied.
- Article category/list/detail use query `locale`, then `Accept-Language`, then English. Global articles are filtered by exact stored locale. Missing translations yield empty lists or 404, not an invented translation. Admin article/category writes persist locale.
- Push installations persist normalized locale. Global JPush notifications are batched by the recipient installation's language with a generic new-message alert. This does not translate stored health conclusions, report PDF content or existing notification bodies.
- GET `/commerce/markets` exposes only explicitly enabled `global.markets` entries: `{markets:[{countryCode,currency,currencyExponent,commerceEnabled:false,paymentChannels:[]}]}`. USD=2, JPY=0, KWD=3 minor-unit exponents are respected. Region is not inferred from language.
- Global addresses accept `{countryCode,name,mobile,province?/region?,city?,district?,detail/addressLine1,postalCode?,isDefault?}`; ISO country and valid international contact phone are required. A delivery phone can differ from the verified account identifier. Verified email accounts pass the same-user commerce guard without a domestic mobile.
- International market SKU price books, tax, shipping, inventory policies and verified international payment rails are **not implemented**. Global checkout fails with `market_checkout_unavailable`, not CNY amounts relabeled as another currency. Existing CNY payment adapters are not exposed as international payment rails; StoreKit retains its separately configured verification boundary for digital services, and report sales remain disabled in the deployment template.
- GET `/support/app-update` reads only public `AppSetting.global_app_update`, never domestic `app_update`. The stored manifest must explicitly have `realm:"global"` and every release's package ID: Android/iOS `cn.saydian.app.global`, HarmonyOS `cn.saydian.app.global.hm`. Available direct destinations must be `/global/down/files/<fileName>` and retain size/hash. iOS uses only real Apple App Store/TestFlight URLs; missing packages remain `coming_soon`. The server validates metadata, not the binary signature: publication must also independently verify actual bundle/package IDs and re-download hashes. Missing global manifest returns 404. `global_support` likewise never falls back to domestic support configuration.

## Operator configuration (no supplied live credentials)

### International admin health display and AI report actions

The admin health dialog displays Chinese metric names, record counts, explicit UTC summary times and original measurement units. Raw measurement time uses the stored `timezoneOffsetMinutes`; missing offsets are explicitly marked and displayed in UTC. Unknown values remain unknown, never zero. Technical UUIDs and the complete original object are retained in expandable details. These labels do not classify readings as medically normal/abnormal or turn an ECG summary score into a diagnosis.

The following routes use the **admin** base `/global/api/saydian-app/admin/v1`, not the member V2 base. Only authenticated effective SUPER_ADMIN/HEALTH_AUDITOR roles may access them:

| Method / path | Request | Result |
| --- | --- | --- |
| GET `/health-reports/availability` | `?memberId=<member UUID>` | `canGenerate`, `reasons[{code,message}]`, `period`, valid record count, distinct days/minimum days, `consentRequired`, `availableCredits`, and latest report identity/status |
| POST `/health-reports` | `{"memberId":"<member UUID>","idempotencyKey":"<unique request UUID>"}` | `{report,reused}`; report uses the existing lower-case status contract |
| GET `/health-reports/<report UUID>` | No body | Report status and `memberId`; only READY returns `content` and `limitations`. Each read requires a persisted `HEALTH_REPORT_READ` audit before returning even the preview. |

Illustrative blocked availability (synthetic structure, not a claim of successful AI execution):

```json
{
  "canGenerate": false,
  "reasons": [{"code":"ai_unconfigured","message":"AI 服务尚未配置"}],
  "period": {"from":"2026-08-11T00:00:00.000Z","to":"2026-09-10T00:00:00.000Z"},
  "validRecordCount": 20,
  "distinctDays": 5,
  "minimumDistinctDays": 3,
  "consentRequired": false,
  "availableCredits": 1,
  "latestReport": null
}
```

Read all returned reasons: inactive member, insufficient data, missing/currently withdrawn or outdated member consent, no report credits, disabled AI, unreadable credentials, paused Worker or demo restrictions each block creation. A configuration check does not prove the Worker is alive or the provider will succeed. The create endpoint repeats server-side validation and returns 409 with `errorKey=health_report_unavailable` plus a safe explanation when blocked. A member must personally accept the current reviewed `health_ai_analysis` notice in the App; the administrator cannot grant it.

One generated report consumes **one report entitlement**, not shopping points or an automatic payment. The UI explicitly confirms this. All create entry points share a member-level transaction lock; creation, credit consumption and the Outbox event commit together. A repeated request key is scoped to the same member and reuses its report; equivalent evidence can also reuse a report across keys. On an uncertain HTTP response, retain the request key and retry. Closing a dialog stops polling, not the server job. Reopening reads the latest saved report. The new panel does not invoke the old retry route.

In the global Worker, consent/account/document validity is rechecked before sending de-identified statistics to AI and again before publishing READY content and notifications. A revoked or changed authorization discards an in-flight result; the existing permanent-failure path restores consumed report credits once. This does not erase the fact that data may already have been sent before a subsequent withdrawal. AI content is text-rendered, not executed as HTML, and remains a wellness reference requiring human review.

This release does not enable AI providers, release Worker outbound pauses, publish consent documents, grant credits, or claim a real provider response. Those are separate environment/consent/operational acceptance steps. Opt-in synthetic permission/gate smoke: run `deploy/global/raw-health-reason-smoke.mjs --synthetic-roles` inside the verified global API container. It only creates its own empty test member and temporary roles, deletes those exact principals afterward and retains access audit history; it must never read an existing member's raw health records or send AI requests.

See [global-deployment.md](global-deployment.md). Configuration keys below exist in source, but this branch contains no configured provider or published legal content.

| Capability | Explicit global configuration required |
| --- | --- |
| Email OTP | `GLOBAL_EMAIL_PROVIDER=webhook`; IntegrationConfig key `email_otp`, state CONFIGURED; publicConfig `{provider:"webhook",deliveryVerified:true}`; secrets `webhookUrl` + `webhookToken` or corresponding `GLOBAL_EMAIL_WEBHOOK_URL/TOKEN` |
| SMS OTP | `GLOBAL_SMS_PROVIDER=webhook`; IntegrationConfig key `sms_global`, state CONFIGURED; same verified public fields plus an explicit tested `countries:[ISO...]` allowlist; independent `GLOBAL_SMS_WEBHOOK_URL/TOKEN` |
| Delivery contract | Authorized HTTPS POST with bearer token and JSON `{channel,recipient,code,purpose,locale,expiresIn:300,challengeId}`; return 2xx only after accepting the delivery. No redirect; 10-second timeout. Provider templates and destination countries require real independent acceptance tests. |
| Legal | `GlobalLegalDocument` records with reviewed=true, active=true, publishedAt<=now, nonempty contentHtml; matching version for terms/privacy; separate health_ai_analysis |
| Market discovery | Enabled CommerceBusinessConfig key `global.markets`, value `{markets:[{countryCode,currency,enabled:true}]}`; this alone never opens checkout |
| Downloads / support | Explicit public `global_app_update` / `global_support` settings from international content; no domestic copied configuration |

## Not yet accepted

No production deployment, new database migration, live email/SMS request, cross-device account flow, real Apple signing/TestFlight, gateway runtime validation, global download publication or international payment occurred. Docker is unavailable on this machine; the deployment script's structural checks are not container/readiness acceptance. Database-backed tests need an isolated test database. Global health report generation/PDF and all stored notification/content translations still require localized templates/content and acceptance; this change does not claim full eight-language backend content or global commerce completion.
