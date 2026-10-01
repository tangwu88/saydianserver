# Say Ring Privacy Policy — DRAFT, DO NOT PUBLISH

Draft version: `draft-2026-10-01-14-plus`

This document is an implementation draft for Say Ring (`cn.saydian.ring`). Build 1013 is the audited legacy package; build 1014 is the intended iOS publication baseline. It must not be linked from App Store Connect, served from a public URL, or activated in the legal-document API until every item under “Publication blockers” is closed.

## Confirmed owner and contact

- Data controller: Xuewu Tang (confirmed by the product owner on 2026-10-01).
- Privacy contact: [kf@saydian.com](mailto:kf@saydian.com) (confirmed by the product owner on 2026-10-01; the domain has active MX records).
- Customer service: [WeCom customer service](https://work.weixin.qq.com/kfid/kfcae32196355fde04c).
- Product: Say Ring, iOS bundle ID `cn.saydian.ring`.

## Publication blockers

1. Confirm the legal names and privacy-policy URLs of every wearable SDK provider in build 1013, and whether any of those SDKs transmit device, health, diagnostic, or identifier data to vendor servers.
2. The Tencent Cloud console has the Party-A profile `微销通(北京)科技有限公司`, but zero contract records. The active service instance is in Beijing. Production backup and security-log retention must still be verified at runtime; a console profile is not a signed contract and must not be described as one.
3. Deploy and production-test the account-deletion repair. The candidate code clears email and verification timestamps, all User WeChat identifiers and official identities, and physically deletes only the account's claimed storage objects before completion; production still runs the older behavior until deployment.
4. The first release is 14+. A Say Ring account-creation request must confirm this without collecting a date of birth for age verification. Support for 13-year-olds remains unavailable until a separate, verifiable guardian-consent workflow is completed. Because App Store offers the next available rating as 16+, App Store Connect must be verified as 16+ before activation.
5. Deploy the candidate Say Ring product-isolation migration and update build 1014 to send `product=say-ring` on legal capabilities and every consent-producing auth flow. Build 1013 continues to request the generic global policy; the dedicated Say Ring documents must remain inactive until the 1014 client and production API have both been verified.
6. Complete legal review and set the effective date. A draft or placeholder page is not acceptable for App Store submission.

## Verified build-1013 boundaries

- Account sign-in and optional WeChat sign-in are enabled.
- Profile data and an optional avatar can be uploaded to the Say Ring service.
- Wearable health summaries are uploaded after sign-in. Detailed sleep-stage timelines remain in the local encrypted store and are not included in the current server health batch.
- Bluetooth device metadata and connection evidence are uploaded when the App reports a ready connection.
- The location-based weather client has no API key in build 1013 and is unavailable; this build does not send location to QWeather.
- JPush has no App Key in build 1013 and is not initialized.
- AI is hidden by the production Say Ring setting, and commerce is disabled in the App Store build. This draft therefore does not describe AI, shopping, or payment processing as active Say Ring features.

## Verified target build-1014 iOS boundary

- The iOS WeChat authorization UI is hidden and `SaidianWechatEnabled=false`.
- The iOS native startup does not register the WeChat SDK; its method channel rejects WeChat authorization and payment.
- iOS continues with phone verification. Weather and push remain unavailable in the target iOS build.
- The first App Store release is available only in mainland China. Other regions remain closed until international sign-in and privacy compliance are completed.
- The public App Review experience is read-only, requires no review account, and is clearly labelled as synthetic demonstration data. It does not load or upload a real account's ring or health data.
- Android retains its existing optional WeChat feature and must send the explicit `say-ring` product identifier when recording consent.

---

# Privacy Policy

Effective date: **[pending legal approval]**

This Privacy Policy explains how Xuewu Tang ("we", "us", or "our") handles personal data when you use the Say Ring application and related services.

Say Ring provides account, smart-ring connection, health-summary, profile, and device-management features. It is not a medical device and does not provide medical diagnosis or treatment.

The first iOS release is offered only in mainland China. Its public review experience uses labelled synthetic demonstration data without requiring an account.

## 1. Data we process

### Account and authentication data

We process the phone number or email address used for registration or sign-in, verification status, encrypted password credentials where applicable, session identifiers, language preference, and account status.

The target iOS build does not offer WeChat sign-in. On Android, if you choose the optional WeChat sign-in, we process the identifiers and profile information returned through WeChat, such as OpenID, UnionID when available, nickname, and avatar.

### Profile and avatar data

We process profile information that you choose to provide, including nickname, avatar, gender, date of birth, height, weight, and activity goals.

If you select or take an avatar photo, the App accesses only the photo you choose and uploads it to our service after you save the profile.

### Smart-ring and Bluetooth data

To connect and manage a supported ring, the App processes Bluetooth name, device model, firmware version, capabilities, a device or hardware identifier, connection time, and MAC address when the platform or device makes one available.

The service stores connection evidence for support and security. A stable pseudonymous device label is derived from the device identifier for administration and troubleshooting.

### Health and activity data

The App may process health and activity records supplied by a connected ring, including steps, distance, calories, heart rate, blood oxygen, blood pressure, temperature, HRV, sleep summaries, and other measurements supported by the connected device.

Health summaries are uploaded to your account so that you can view them across sessions. Detailed sleep-stage timelines are kept in the App's local encrypted store in the current version and are not included in the current server health upload.

These measurements are for general wellness reference only. They are not medical diagnoses and must not replace professional medical advice or emergency care.

### Technical and security data

We process request identifiers, session and authentication events, App platform and version, error state, and security or audit records needed to operate, protect, and troubleshoot the service.

The App avoids placing account identifiers, health values, authentication tokens, or precise request data in ordinary diagnostic logs.

## 2. How we use data

We use personal data to create and secure accounts, connect supported rings, synchronize user-requested health summaries, display account and device information, provide customer support, prevent abuse, and comply with applicable legal obligations.

We do not use Say Ring health data for advertising. We do not sell personal data.

## 3. Device permissions

Bluetooth permission is used to discover and communicate with supported rings. Camera and photo-library permissions are used only when you choose to take or select an avatar.

The current build does not enable the external weather service. If a future version enables location-based weather, this policy and the in-App disclosure must be updated before location is sent to a weather provider.

## 4. Sharing and service providers

We disclose personal data only as needed to provide a feature you request, operate the service, protect users, or comply with law.

- WeChat: the target iOS build does not enable this feature. On Android, if you choose WeChat sign-in, authentication data is exchanged with WeChat/Tencent under its applicable terms and privacy notice.
- Cloud hosting: account, profile, device, and health-summary data are processed on infrastructure used by the Say Ring service in Beijing, mainland China. The Tencent Cloud console has a Party-A profile, but no signed Tencent Cloud contract record. This policy must not identify that profile as a contract until a signed contract exists.
- Wearable SDK providers: the App includes third-party libraries used to communicate with supported rings and perform firmware or device operations. The Android watch-face catalogue makes HTTPS requests to `www.vphband.com:9001` with ring compatibility fields, App version, and paging values; its request does not include the app's device ID. **[The providers' legal names, SDK network behavior, data categories, and privacy links remain pending vendor confirmation.]**

Before publication, we must confirm that every third party receiving personal data provides the same or equivalent protection described in this policy.

## 5. Regional availability and international processing

The first App Store release is not offered outside mainland China. We do not describe international availability or cross-border safeguards as active for this release.

Before Say Ring is opened in another country or region, we will assess the applicable transfer mechanism, contractual safeguards, local representative requirements, and country-specific disclosures, and update this policy before that availability begins.

## 6. Retention and account deletion

We retain account and service data only while needed to provide Say Ring, protect the service, meet legal obligations, or resolve disputes. The candidate deployment configuration keeps database backup files for 30 days and Restic snapshots as 14 daily, 8 weekly, and 12 monthly copies. **[These are source configuration values, not verified production retention; security-log retention remains pending confirmation.]**

You can initiate account deletion inside the App. The current production service disables the account and revokes active sessions immediately, then schedules deletion or anonymization after a seven-day waiting period.

Some records may need to be retained when required by law or for the establishment, exercise, or defense of legal claims. They will be restricted to those purposes. **[Do not publish until the deletion repair is deployed and verified against production storage.]**

## 7. Your choices and rights

Depending on applicable law, you may request access, correction, deletion, restriction, portability, or withdrawal of consent. You may also disconnect a ring, remove optional profile information, or initiate account deletion in the App.

Send privacy requests to [kf@saydian.com](mailto:kf@saydian.com). You may also contact [WeCom customer service](https://work.weixin.qq.com/kfid/kfcae32196355fde04c).

We may need to verify that a request relates to your account before acting on it. Withdrawing consent does not affect processing that was lawful before withdrawal.

## 8. Children

Say Ring is currently for people aged 14 or older. At account creation, we ask you to confirm that you meet this minimum age and record only that confirmation, its version, and its time; we do not require your full date of birth for this check.

Say Ring does not currently offer accounts to people under 14. Support for 13-year-olds is deferred until a separate guardian-consent flow can verify the guardian's authority, record consent, and provide the required health-data safeguards.

## 9. Security

We use access controls, encrypted transport, credential protection, data minimization, and operational safeguards designed to protect personal data. No system can guarantee absolute security.

## 10. Changes to this policy

We will update this policy when Say Ring's features, service providers, data practices, or legal requirements change. Material changes will be presented in the App before they take effect when renewed consent is required.

## 11. Contact

Controller: Xuewu Tang

Privacy email: [kf@saydian.com](mailto:kf@saydian.com)

Customer service: [WeCom customer service](https://work.weixin.qq.com/kfid/kfcae32196355fde04c)
