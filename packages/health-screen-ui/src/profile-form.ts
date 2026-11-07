import type { ScreenProfile, ScreenProfileGate } from "@saydian/app-contracts";

export const DEFAULT_FORM_BIRTHDAY = "1990-01-01";

export function profileFormDraft({ profile, canComplete }: ScreenProfileGate): ScreenProfile {
  return {
    ...profile,
    birthday: canComplete && !profile.birthday ? DEFAULT_FORM_BIRTHDAY : profile.birthday,
  };
}
