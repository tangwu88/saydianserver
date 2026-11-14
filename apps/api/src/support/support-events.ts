import { HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { setTimeout as delay } from "node:timers/promises";

const active = new Map<string, number>();

/** Short-lived SSE streams use the database as the replay source across API
 * instances. Only a visible inbox/thread opens a stream; no in-memory message
 * bus or proxy buffer can cause acknowledged messages to be lost. */
export async function supportEvents<T>(
  response: Response,
  key: string,
  read: () => Promise<T>,
  reauthorize: () => Promise<unknown>,
) {
  const count = active.get(key) ?? 0;
  if (count >= 3)
    throw new HttpException(
      "会话窗口过多，请关闭后重试",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  active.set(key, count + 1);
  const close = new AbortController();
  response.once("close", () => close.abort());
  try {
    const first = await read();
    if (close.signal.aborted) return;
    response.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    const deadline = Date.now() + 36_000;
    let previous = JSON.stringify(first),
      expiryCheck = Date.now() + 4_000,
      heartbeat = Date.now() + 12_000;
    if (!response.write(`data: ${previous}\n\n`)) return;
    while (!close.signal.aborted && Date.now() < deadline) {
      await delay(650, undefined, { signal: close.signal });
      if (Date.now() >= expiryCheck) {
        await reauthorize();
        expiryCheck = Date.now() + 4_000;
      }
      const current = JSON.stringify(await read());
      if (current !== previous) {
        if (!response.write(`data: ${current}\n\n`)) break;
        previous = current;
      } else if (Date.now() >= heartbeat) {
        if (!response.write(": keep-alive\n\n")) break;
        heartbeat = Date.now() + 12_000;
      }
    }
  } catch (error) {
    if (!response.headersSent && !close.signal.aborted) throw error;
  } finally {
    const remaining = (active.get(key) ?? 1) - 1;
    if (remaining > 0) active.set(key, remaining);
    else active.delete(key);
    if (response.headersSent && !response.writableEnded) response.end();
  }
}
