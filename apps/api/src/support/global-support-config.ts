export type GlobalSupportConfig = {
  configured: boolean;
  phone?: string;
  officialAccount?: string;
  serviceHours?: string;
  message?: string;
};

const phonePattern = /^\+?[0-9][0-9 -]{4,20}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > maximumLength || controlCharacters.test(text)) {
    return "";
  }
  return text;
}

function result(
  configured: boolean,
  phone: string,
  officialAccount: string,
  serviceHours: string,
  message: string,
): GlobalSupportConfig {
  return {
    configured,
    ...(phone ? { phone } : {}),
    ...(officialAccount ? { officialAccount } : {}),
    ...(serviceHours ? { serviceHours } : {}),
    ...(message ? { message } : {}),
  };
}

export function normalizePublishedGlobalSupport(
  value: unknown,
  unavailableMessage: string,
): GlobalSupportConfig {
  const source = objectValue(value);
  const legacyPhone =
    source.phone === undefined &&
    (typeof source.configured === "number" ||
      typeof source.configured === "string")
      ? String(source.configured).trim()
      : "";
  const phone = optionalText(source.phone ?? legacyPhone, 21);
  const officialAccount = optionalText(source.officialAccount, 64);
  const serviceHours = optionalText(source.serviceHours, 120);
  const message = optionalText(source.message, 240);
  const configured =
    (source.configured === true || Boolean(legacyPhone)) &&
    Boolean(phone || officialAccount);

  if (!configured || (phone && !phonePattern.test(phone))) {
    return {
      configured: false,
      message: message || unavailableMessage,
    };
  }
  return result(true, phone, officialAccount, serviceHours, message);
}

export function parseGlobalSupportSetting(value: unknown): GlobalSupportConfig {
  const source = objectValue(value);
  if (typeof source.configured !== "boolean") {
    throw new Error("客服启用状态必须为开启或关闭");
  }
  const phone = optionalText(source.phone, 21);
  const officialAccount = optionalText(source.officialAccount, 64);
  const serviceHours = optionalText(source.serviceHours, 120);
  const message = optionalText(source.message, 240);

  if (source.phone && (!phone || !phonePattern.test(phone))) {
    throw new Error("客服电话格式无效");
  }
  if (source.officialAccount && !officialAccount) {
    throw new Error("微信公众号长度或内容无效");
  }
  if (source.serviceHours && !serviceHours) {
    throw new Error("服务时间长度或内容无效");
  }
  if (source.message && !message) {
    throw new Error("客服说明长度或内容无效");
  }
  if (source.configured && !phone && !officialAccount) {
    throw new Error("启用客服前请填写客服电话或微信公众号");
  }
  return result(
    source.configured,
    phone,
    officialAccount,
    serviceHours,
    message,
  );
}
