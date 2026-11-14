import { adminSessionKey } from "./api";

/** Fetch SSE with a header: the admin credential never appears in a URL. */
export async function consumeSupportEvents<T>(
  path: string,
  options: {
    signal: AbortSignal;
    session: string;
    receive: (value: T) => void;
  },
) {
  const response = await fetch(
    `/api/saydian-app/admin/v1/support-chat${path}`,
    {
      signal: options.signal,
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${options.session}`,
        Accept: "text/event-stream",
      },
    },
  );
  if (response.status === 401 || response.status === 403)
    return "expired" as const;
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error("stream unavailable");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (!options.signal.aborted && adminSessionKey() === options.session) {
      const chunk = await reader.read();
      if (
        chunk.done ||
        options.signal.aborted ||
        adminSessionKey() !== options.session
      )
        break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 256_000) throw new Error("event too large");
      const frames = pending.split("\n\n");
      pending = frames.pop() ?? "";
      for (const frame of frames)
        if (frame.startsWith("data: "))
          options.receive(JSON.parse(frame.slice(6)) as T);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return "closed" as const;
}

export type Conversation = {
  id: string;
  state: string;
  locale: string;
  updatedAt: string;
  lastSeq: number;
  unread: boolean;
  guest: boolean;
  assignedAdminId: string | null;
};
export type SupportMessage = {
  id: string;
  seq: number;
  clientMessageId?: string;
  sender: string;
  body: string;
  createdAt: string;
  attachment?: { id: string } | null;
};
export type Thread = {
  conversation: Conversation;
  messages: SupportMessage[];
  older: boolean;
};
export type Queue = { items: Conversation[]; next: string | null };
export function mergeSupportMessages(
  current: SupportMessage[],
  incoming: SupportMessage[],
) {
  return [
    ...new Map([...current, ...incoming].map((row) => [row.seq, row])).values(),
  ].sort((a, b) => a.seq - b.seq);
}
