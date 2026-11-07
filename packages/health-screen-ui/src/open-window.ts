/** Open an internal screen with the existing tab-scoped sign-in, then sever the opener.
 * No credential or health data is placed in a URL, message, or persistent storage.
 * Opening a same-origin blank window lets the browser copy sessionStorage before
 * severing its opener; a noopener link would otherwise lose the current sign-in.
 */
export function openHealthScreen(scope: "admin" | "vip", memberId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(memberId)) {
    throw new Error("会员编号格式不正确");
  }
  if (scope !== "admin" && scope !== "vip") throw new Error("入口不可用");
  const path = `/${scope}/members/${memberId}/health-screen`;
  const opened = window.open("about:blank", "_blank");
  if (!opened) {
    window.location.assign(path);
    return;
  }
  opened.opener = null;
  opened.location.replace(path);
}
