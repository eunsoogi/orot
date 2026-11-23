import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import type { ConversationToolEvent } from '@orot/agent-runtime';

export const toolAppendPhases = [
  'setup',
  'decode',
  'admission',
  'body',
  'lineage_validation',
  'settlement',
] as const;
type Phase = (typeof toolAppendPhases)[number];
type Point = { readonly tick: number; readonly time: number };

function signal() {
  let release!: () => void;
  const done = new Promise<void>(resolve => {
    release = resolve;
  });
  return { done, release };
}

export function heldAppendInterval() {
  const entered = signal();
  const stopped = signal();
  return {
    entered: entered.done,
    release: stopped.release,
    wait: () => {
      entered.release();
      return stopped.done;
    },
  };
}

export const syntheticTurn = {
  sessionId: 'synthetic-session',
  messageId: 'synthetic-message',
  sessionVersion: 0,
  createdAt: '2026-11-06T00:00:00.000Z',
};
export const startedToolEvent: ConversationToolEvent = {
  version: 1,
  operationRunId: 'synthetic-run',
  callId: 'synthetic-call',
  toolName: 'local_search',
  order: 1,
  status: 'started',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};

/** Tick values represent controlled holds, not physical time. Wall times are sampled separately. */
export function createToolAppendClock() {
  let tick = 0;
  const at = (): Point => ({ tick, time: performance.now() });
  const elapsed = (start: Point, end = at()) => ({
    heldTicks: end.tick - start.tick,
    hostMs: end.time - start.time,
  });
  const stages = new Map<Phase, { start: Point; end?: Point }>();
  const hasStarted = (phase: Phase) => stages.has(phase);
  const bodyActive = () => hasStarted('body') && !hasStarted('settlement');
  const track = (feature: string, stage: string, outcome: string) => {
    const phase = toolAppendPhases.find(p => stage === 'tool_event_write_' + p);
    if (feature !== 'storage' || !phase) return;
    if (outcome === 'started') stages.set(phase, { start: at() });
    else if (outcome === 'completed') {
      const entry = stages.get(phase);
      if (entry) entry.end = at();
    }
    return phase;
  };
  const duration = (phase: Phase) => {
    const value = stages.get(phase);
    if (!value?.end) throw new Error('No completed synthetic phase: ' + phase);
    return elapsed(value.start, value.end);
  };
  const release = (
    interval: ReturnType<typeof heldAppendInterval>,
    heldTicks: number,
  ) => {
    tick += heldTicks;
    interval.release();
  };
  return { at, elapsed, track, bodyActive, hasStarted, duration, release };
}

/** Await intervals can overlap if the transaction launches SQL concurrently; count their union. */
function elapsedUnion(
  intervals: readonly { before: Point; after: Point }[],
  dimension: keyof Point,
) {
  let sum = 0;
  let right = Number.NEGATIVE_INFINITY;
  for (const { before, after } of [...intervals].sort(
    (a, b) => a.before[dimension] - b.before[dimension],
  )) {
    sum += Math.max(0, after[dimension] - Math.max(right, before[dimension]));
    right = Math.max(right, after[dimension]);
  }
  return sum;
}

export function observeSyntheticAppend(
  database: SqlDatabase,
  clock: ReturnType<typeof createToolAppendClock>,
  setup: ReturnType<typeof heldAppendInterval>,
  afterSql: ReturnType<typeof heldAppendInterval>,
  settlement: ReturnType<typeof heldAppendInterval>,
) {
  const sqlIntervals: { before: Point; after: Point }[] = [];
  // This is the exact previous event and stored lineage read.
  const isHeldQuery = (query: string) =>
    clock.bodyActive() && query.startsWith('SELECT e.message_id, e.created_at');
  const observedTx = (tx: SqlTransaction): SqlTransaction => ({
    ...tx,
    async execute(query, bindings) {
      const before = clock.at();
      const result = await tx.execute(query, bindings);
      sqlIntervals.push({ before, after: clock.at() });
      // Deliberately outside the driver await: not all body time is SQL time.
      if (isHeldQuery(query)) await afterSql.wait();
      return result;
    },
  });
  const observed: SqlDatabase = {
    async execute(query, bindings) {
      if (query === 'PRAGMA temp_store = MEMORY') await setup.wait();
      return database.execute(query, bindings);
    },
    transaction: work =>
      database.transaction(async tx => {
        // The adapter setup transaction is not the terminal write.
        if (!clock.hasStarted('admission')) return work(tx);
        await work(observedTx(tx));
        // The real scheduler commits only after this callback returns.
        await settlement.wait();
      }),
  };
  const sql = () => ({
    calls: sqlIntervals.length,
    heldTicks: elapsedUnion(sqlIntervals, 'tick'),
    hostMs: elapsedUnion(sqlIntervals, 'time'),
  });
  return { observed, sql, isHeldQuery };
}
