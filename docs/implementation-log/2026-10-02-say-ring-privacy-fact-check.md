# Say Ring privacy fact check (2026-10-02)

Read-only review of `origin/main`/the merged service tree and the live public API. This note is operational evidence, not legal advice.

The live public API was reread at 2026-10-02 14:46 UTC: paired v2 (`say-ring-cn-2026-10-02-v2`) is `reviewed=true`, `active=true`; both documents state 14+ and that session/account deletion is pending without an automatic completion promise. The user later directed a 13+ policy. This branch now contains only a v3 static preview marked not effective; v2 is not modified. Do not deploy v3 or mark it reviewed/active until the runtime age gate and required guardian-consent flow are reconciled and review is complete.

## Confirmed implementation

- `say-ring` selects its own `say_ring_user_agreement` and `say_ring_privacy_policy`, but it uses the shared `User`, `UserSession`, `ConsentRecord`, and global-auth service. It is not a separate member database. Do not imply Say Ring and Health have separate accounts.
- Live `zh-Hans` capabilities at 2026-10-02 14:31 UTC: registration reports email/SMS enabled and `verificationRequired:false`; login reports `email:false`, SMS enabled, WeChat enabled. In this service, the email capability reflects email-code delivery readiness, not whether password login works. A user-authorized existing demo account successfully completed `/auth/login` with email/password (HTTP 201, application code 200) and `/members/me` (HTTP 200). A registration check with age unconfirmed returned 400; with age confirmed it returned 409 because the account already existed, so it created no account and did not establish the new-account OTP behavior. Do not change switches in this task; describe actual login methods and verified-registration requirements only after checking the client flow.
- One production host is configured for the service; the user identified the Tencent Cloud Beijing region. PostgreSQL, Redis, MinIO and the app run as Docker services. This supports saying the service is hosted in mainland China/Beijing only if the production instance is still in that region. The cloud contract's legal entity is not present in this repository and must not be invented. `OBJECT_STORAGE_REGION=us-east-1` is an S3 API region label for the in-network MinIO service, not evidence of a US data center.
- Account data includes mobile/email identifiers, password hash, locale, nickname, avatar URL, gender, birthday, height/weight, login sessions and consent records. WeChat identity may also be bound. Passwords are stored as a hash, not plaintext.
- Device bindings store vendor, model, display name, hardware key, reported MAC (when supplied), firmware, capabilities and connection times. Connection events store the complete delimited `rawPayload`, which can contain device ID, MAC and other client-reported fields. Health records store metric, timestamp/time-zone offset, values, source platform/model/firmware and device identifiers where supplied.
- Say Ring avatar upload is an authenticated endpoint, validates and normalizes an image (up to 10 MiB input and 1024 px), then writes it under a private persistent Docker volume at `/var/lib/saydian/say-ring-avatars`. A daily separate avatar archive is configured to retain seven days. The production compose default for `SAY_RING_LOCAL_AVATAR_WRITE_ENABLED` is false; the live override was not verified, so do not promise upload availability until confirmed.
- Database dump cleanup is configured for files older than 30 days. This is a backup retention setting, not proof that a deletion request removes live data.
- Account deletion request immediately marks the account `DELETION_PENDING`, revokes sessions and disables push installations; it records an `executeAfter` seven days later. No execution/erasure worker for that request exists in this code tree. Do not promise that the account or its data is automatically deleted in seven days. It is accurate to say the request is queued and access is disabled; a human process must complete and verify erasure.
- The code currently records the terms/privacy version and requires a Say Ring age confirmation of 14+. No separate health-data-consent flow was found. Current health upload/sync can happen in the signed-in path; therefore do not promise that health data is only cloud-processed after a separate consent until the client actually implements that gate.
- The current public pages are `/say-ring/terms` and `/say-ring/privacy`; `/terms` currently returns 404. Both existing static pages incorrectly describe an iOS local-only/no-account/no-cloud-sync build.

## Public-copy recommendations

- State plainly that account mode uses the shared Saydian account service; policy documents and consent versions remain product-specific.
- Do not interpret `login.email:false` as password-login availability; it reflects email-code delivery readiness. Email/password login was separately tested successfully. Avoid promising registration verification until its code path is tested for a genuinely new identity.
- Disclose that signing in and syncing sends account/profile, device/connection and health records to the service. Include device identifiers/MAC and raw connection report fields only as the connected client supplies them. Do not describe any raw field as guaranteed to be absent.
- State the host region only as mainland China/Beijing after a production-region check; name Tencent Cloud as infrastructure only if the operator has confirmed that service relationship. Do not invent the cloud contracting entity or SDK/SMS vendor legal names.
- Explain retention without a false deletion promise: live records are kept while needed to provide the account service; an account-delete request disables access immediately and is queued with a seven-day target, but completion must be confirmed. Configured backups retain database dumps up to 30 days and avatar archives seven days. Legal holds or mandatory retention may extend necessary records.
- Do not claim health-data “separate consent” currently exists. Add a visible, separately recorded choice before cloud health sync or keep that processing disabled until implemented.
- Use the supplied operator/contact details only as confirmed: Xuewu Tang; `kf@saydian.com`. Avoid asserting legal-professional review.

## Outstanding before publication

1. Verify the production region and avatar-write override from the server.
2. Confirm the new-account verification path and live delivery-provider configuration separately from password login. An existing-account duplicate-registration response does not prove a new account is properly verified.
3. Implement an actual deletion executor and verify the user-data deletion/backup behavior, or explain the present manual workflow and response timeline without suggesting automatic erasure.
4. Add the missing separate health-data consent before enabling cloud health sync.

## Age-policy change requested after v2 publication

- The user now sets the proposed threshold to 13+, with prior guardian consent and guidance for ages 13–17. This differs from live v2 and current client/server validation (14+).
- A v3 static preview was updated to the requested age wording, but remains unreviewed and not effective. Do not activate it or change v2 until legal review and runtime age/guardian-consent controls are aligned.
