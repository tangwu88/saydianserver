/** Reserved stable tier code, independent of editable names and session claims. */
export function canReadPartnerHealth(
  partner:
    | { active: boolean; level: { code: string; active: boolean } }
    | null
    | undefined,
): boolean {
  return (
    !!partner?.active &&
    partner.level.active &&
    partner.level.code === "distribution-1"
  );
}
