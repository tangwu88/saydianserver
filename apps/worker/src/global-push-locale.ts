const messages: Record<string, string> = {
  en: "You have a new Saydian message.",
  "zh-Hans": "你有一条新的 Saydian 消息。",
  "zh-Hant": "你有一則新的 Saydian 訊息。",
  de: "Du hast eine neue Saydian-Nachricht.",
  fr: "Vous avez un nouveau message Saydian.",
  es: "Tienes un nuevo mensaje de Saydian.",
  ja: "Saydianから新しいメッセージがあります。",
  ko: "새로운 Saydian 메시지가 있습니다.",
};

export function globalPushAlert(locale: string | null): string {
  const value = (locale ?? "en").replace(/_/g, "-");
  if (/^zh-(TW|HK|MO|Hant)(-|$)/i.test(value)) return messages["zh-Hant"]!;
  if (/^zh(-|$)/i.test(value)) return messages["zh-Hans"]!;
  return messages[value] ?? messages[value.split("-")[0]!] ?? messages.en!;
}
