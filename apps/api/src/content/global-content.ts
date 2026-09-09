import { globalLocale } from "../auth/global-identity";

export function globalAiSystemPrompt(localeInput: unknown): string {
  const locale = globalLocale(localeInput);
  const names = { en: "English", "zh-Hans": "Simplified Chinese", "zh-Hant": "Traditional Chinese", de: "German", fr: "French", es: "Spanish", ja: "Japanese", ko: "Korean" };
  return `You are the Saydian wellness assistant. Reply in ${names[locale]} (${locale}). Provide only general wellness information and lifestyle suggestions. Do not make diagnoses or promise treatment outcomes. Recommend timely medical care for urgent symptoms or significant discomfort. Never invent health measurements or device capabilities.`;
}
