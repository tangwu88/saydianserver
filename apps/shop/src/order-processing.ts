type Context = { id: string; session: string; screen: number };
type Snapshot = { state: string; syncedAt?: string; logisticsUnavailable?: boolean; items?: { id: string; name: string; time: string }[] };
/** Bounded polling with a generation guard, including the final order reread. */
export function createOrderProcessing(options: {
  request: (path: string, input: Record<string, unknown>) => Promise<any>;
  current: (context: Context) => boolean;
  progress: (snapshot: Snapshot) => void;
  apply: (order: any) => void;
}) {
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  function stop() { generation++; clearTimeout(timer); timer = undefined; }
  async function start(context: Context) {
    stop();
    const run = generation;
    const active = () => run === generation && options.current(context);
    const endpoint = '/storefront/orders/' + encodeURIComponent(context.id);
    const input = { auth: true, sessionStamp: context.session };
    async function read(attempt: number): Promise<void> {
      try {
        const snapshot = await options.request(endpoint + '/processing', { ...input, method: attempt === 0 ? 'POST' : 'GET' });
        if (!active()) return;
        options.progress(snapshot);
        if (snapshot.state === 'PENDING') {
          if (attempt < 12) timer = setTimeout(() => { if (active()) void read(attempt + 1); }, 2500);
          else options.progress({ ...snapshot, state: 'TIMEOUT' });
          return;
        }
        if (snapshot.state === 'READY') {
          const order = await options.request(endpoint, input);
          if (active()) options.apply(order);
        }
      } catch { if (active()) options.progress({ state: 'ERROR' }); }
    }
    if (active()) await read(0);
  }
  return { start, stop };
}
