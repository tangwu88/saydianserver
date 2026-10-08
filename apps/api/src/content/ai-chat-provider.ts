import { ServiceUnavailableException } from "@nestjs/common";
import { safeObject } from "../common/crypto";
import { globalAiSystemPrompt } from "./global-content";

export interface ChatFailureDiagnostic {
  event: "ai_chat_provider_failure";
  errorKey: string;
  upstreamStatus: number | null;
  providerCode: string | null;
  durationMs: number;
}

// Never log a request, response, exception, URL, credential or account identifier.
export async function callChatProvider(
  content: string,
  settings: { baseUrl: string; apiKey: string; model: string },
  locale: string | undefined,
  diagnose: (failure: ChatFailureDiagnostic) => void,
): Promise<string> {
  const started = Date.now();
  let errorKey = "AI_PROVIDER_NETWORK";
  let upstreamStatus: number | null = null;
  let providerCode: string | null = null;
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: globalAiSystemPrompt(locale) },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    upstreamStatus = response.status;
    if (!response.ok) {
      errorKey =
        response.status === 401 || response.status === 403
          ? "AI_PROVIDER_AUTH"
          : response.status === 402 || response.status === 429
            ? "AI_PROVIDER_LIMIT"
            : response.status >= 500
              ? "AI_PROVIDER_UNAVAILABLE"
              : "AI_PROVIDER_REJECTED";
      try {
        const payload = safeObject(await response.json());
        const code = String(safeObject(payload.error).code ?? "");
        // Only a bounded numeric provider error code; never its free-text message.
        if (/^\d{3,6}$/.test(code)) providerCode = code;
      } catch {
        /* The HTTP rejection remains authoritative. */
      }
      throw new Error("provider_rejected");
    }
    errorKey = "AI_PROVIDER_INVALID_RESPONSE";
    const payload = safeObject(await response.json());
    const first = safeObject(
      Array.isArray(payload.choices) ? payload.choices[0] : undefined,
    );
    const message = safeObject(first.message);
    if (typeof message.content !== "string" || !message.content.trim())
      throw new Error("empty_reply");
    return message.content.trim();
  } catch (error) {
    // Only compare the standard name; never persist an upstream exception message.
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      errorKey = "AI_PROVIDER_TIMEOUT";
    const durationMs = Math.max(0, Date.now() - started);
    diagnose({
      event: "ai_chat_provider_failure",
      errorKey,
      upstreamStatus,
      providerCode,
      durationMs,
    });
    throw new ServiceUnavailableException({
      errorKey,
      message: "AI service is temporarily unavailable. Please try again later.",
      data: { upstreamStatus, providerCode, durationMs },
    });
  }
}
