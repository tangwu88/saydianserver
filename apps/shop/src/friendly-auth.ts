/** Only curated user messages reach the screen; provider/config diagnostics stay out of the UI. */
export function authUiError(message: string) { return Object.assign(new Error(message), { userFacing: true }); }
export function authErrorMessage(cause: unknown, fallback = "暂时无法完成，请稍后重试。") {
  const error = cause as { errorKey?: string; status?: number; message?: string; userFacing?: boolean } | null;
  const messages: Record<string, string> = {
    invalid_credentials: "账号或密码不正确，请重新输入。",
    account_verification_required: "请先完成手机号确认，再登录账号。",
    phone_password_required: "请输入该手机号原账号的密码。",
    identity_conflict: "无法关联此手机号，请使用账号密码登录或联系客服。",
    invalid_phone: "请检查国家区号和手机号。",
    invalid_email: "请输入正确的邮箱地址。",
    verification_invalid: "验证码不正确，请重新输入。",
    verification_used: "验证码已使用，请重新获取。",
    verification_expired: "验证码已过期，请重新获取。",
    verification_rate_limited: "操作较频繁，请稍后再试。",
    consent_required: "请先阅读并同意用户协议与隐私政策。",
    consent_outdated: "协议已更新，请重新阅读并同意。",
    legal_unavailable: "协议暂时无法查看，请稍后重试。",
    wechat_authorization_expired: "微信登录已过期，请重新登录。",
    wechat_oauth_expired: "微信登录已过期，请重新登录。",
    wechat_binding_expired: "微信登录已过期，请重新登录。",
  };
  if (error?.errorKey && messages[error.errorKey]) return messages[error.errorKey]!;
  if (error?.status === 429) return "操作较频繁，请稍后再试。";
  if (error?.status === 401) return "登录信息不正确或已过期，请重试。";
  if (error?.status && error.status >= 500) return "服务暂时不可用，请稍后再试。";
  if (error?.status) return fallback;
  if (/network|timeout|request:fail|网络/i.test(error?.message || "")) return "网络连接失败，请检查网络后重试。";
  return error?.userFacing && error.message ? error.message : fallback;
}
