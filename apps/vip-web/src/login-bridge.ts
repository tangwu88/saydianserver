import { safeReturnPath } from "./navigation";
export const memberVerifierKey = "saydian-vip-member-verifier";
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function beginMemberLogin(next: unknown) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  sessionStorage.setItem(memberVerifierKey, verifier);
  location.assign(
    `/saidian-mall/#/pages/partner/index?autoLogin=1&next=${encodeURIComponent(safeReturnPath(next))}&challenge=${encodeURIComponent(challenge)}`,
  );
}
