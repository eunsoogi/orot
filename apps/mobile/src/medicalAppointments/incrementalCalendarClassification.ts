import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  type CalendarClassificationCache,
  type CachedCalendarDecision,
} from '@orot/storage';
import { t } from '../i18n';
import { calendarEventsMatch } from './calendarEvidence';
import {
  canStoreClassifiedCalendarBatches,
  exactKeys,
} from './calendarClassificationWitnesses';
import { createClassificationCandidates } from './classificationCandidates';
import {
  classifyCalendarEvents,
  type ClassifyCalendarEventsInput,
  type ClassificationRunResult,
} from './classificationWorkflow';

/** Reuse only an unchanged witness reread in a fresh, fully authorized EventKit snapshot.
 * Remote authorization still runs in the canonical workflow for actual misses only.
 */
export async function classifyCalendarEventsIncrementally(
  input: ClassifyCalendarEventsInput & {
    readonly onWorkPlan?: (missingCount: number) => void;
  },
  cache: CalendarClassificationCache | undefined,
): Promise<ClassificationRunResult> {
  // Unknown/native older adapters leave existing behavior unchanged, not an invented cache hit.
  if (
    !cache ||
    !input.bridge.listUpcomingEvents ||
    (input.events.length > 0 && !exactKeys(input.events).some(Boolean))
  ) {
    input.onWorkPlan?.(input.events.length);
    return classifyCalendarEvents(input);
  }
  const base = createClassificationCandidates(input.events);
  const rejected = (
    status: 'cancelled' | 'unavailable',
  ): ClassificationRunResult => ({
    status,
    candidates: base,
    completedBatches: 0,
    totalBatches: 0,
  });
  if (input.signal.aborted) return rejected('cancelled');
  const keys = exactKeys(input.events);
  const readCurrentSnapshot = async () => {
    const live = await input.bridge.listUpcomingEvents!();
    if (input.signal.aborted || live.access !== 'fullAccess') return;
    const liveKeys = exactKeys(live.events);
    const eventsByKey = new Map(
      live.events.flatMap((event, index) =>
        liveKeys[index] ? [[liveKeys[index]!.occurrence, event] as const] : [],
      ),
    );
    const complete = live.query?.complete === true && liveKeys.every(Boolean);
    // A complete snapshot additionally proves no addressable event appeared or disappeared.
    if (complete && keys.every(Boolean) && liveKeys.length !== keys.length)
      return;
    for (const [index, key] of keys.entries()) {
      if (!key) continue;
      const event = eventsByKey.get(key.occurrence);
      if (!event || !calendarEventsMatch(input.events[index]!, event)) return;
    }
    return { liveKeys, complete };
  };
  if (!(await readCurrentSnapshot()))
    return rejected(input.signal.aborted ? 'cancelled' : 'unavailable');
  const selected = keys.flatMap(key => (key ? [key.occurrence] : []));
  const { generation, rows: cached } = await cache.read(selected, input.signal);
  if (input.signal.aborted) return rejected('cancelled');
  const cachedById = new Map(cached.map(item => [item.occurrence, item]));
  const reused = keys.map(key =>
    key && cachedById.get(key.occurrence)?.revision === key.revision
      ? cachedById.get(key.occurrence)
      : undefined,
  );
  const missing = input.events.flatMap((event, index) =>
    reused[index] ? [] : [{ event, index }],
  );
  input.onWorkPlan?.(missing.length);
  const hasReused = reused.some(Boolean);
  const compose = (fresh: ClassificationRunResult, includeReused: boolean) => {
    const candidates = base.slice();
    for (let index = 0; index < missing.length; index++) {
      const item = missing[index]!;
      const candidate = fresh.candidates[index];
      if (candidate)
        candidates[item.index] = {
          ...candidate,
          candidateId: base[item.index]!.candidateId,
        };
    }
    if (includeReused) {
      for (let index = 0; index < reused.length; index++) {
        const decision = reused[index];
        if (!decision) continue;
        candidates[index] = {
          ...base[index]!,
          status: 'classified',
          reusedClassification: true,
          classification: decision.classification,
          uncertainty: decision.uncertainty,
          reason: t(
            `medicalAppointments.classification.${decision.classification}`,
          ),
        };
      }
    }
    return { ...fresh, candidates };
  };
  const result = missing.length
    ? await classifyCalendarEvents({
        ...input,
        events: missing.map(({ event }) => event),
        provider: guardCacheOwner(
          input.provider,
          cache,
          generation,
          input.signal,
          hasReused ? readCurrentSnapshot : undefined,
        ),
        onProgress: progress => input.onProgress?.(compose(progress, false)),
      })
    : {
        status: 'complete' as const,
        candidates: [],
        completedBatches: 0,
        totalBatches: 0,
      };
  if (input.signal.aborted) return rejected('cancelled');
  if (!canStoreClassifiedCalendarBatches(result)) return compose(result, false);
  const staged: CachedCalendarDecision[] = [];
  for (let index = 0; index < missing.length; index++) {
    const key = keys[missing[index]!.index];
    const verdict = result.candidates[index];
    if (
      key &&
      verdict?.status === 'classified' &&
      verdict.classification &&
      verdict.uncertainty
    )
      staged.push({
        ...key,
        classification: verdict.classification,
        uncertainty: verdict.uncertainty,
      });
  }
  // Cached rows bypass the model workflow's evidence check. Before pruning or
  // persisting, re-read the exact occurrence revisions after all awaited work.
  const terminal = await readCurrentSnapshot();
  if (!terminal)
    return rejected(input.signal.aborted ? 'cancelled' : 'unavailable');
  // A partial or ambiguous snapshot cannot prove a source was removed.
  const pruneTo =
    result.status === 'complete' && terminal.complete
      ? terminal.liveKeys.map(key => key!.occurrence)
      : undefined;
  await cache.commit(generation, staged, pruneTo, input.signal);
  if (input.signal.aborted) return rejected('cancelled');
  // A native edit while the protected write awaited must not publish cached
  // hits or the completed rows of an admitted partial result.
  if (hasReused || result.status === 'partial') {
    if (!(await readCurrentSnapshot()))
      return rejected(input.signal.aborted ? 'cancelled' : 'unavailable');
    try {
      // A wipe during the final native read retires the whole result.
      await cache.startIfCurrent(generation, input.signal, () => undefined);
    } catch {
      return rejected(input.signal.aborted ? 'cancelled' : 'unavailable');
    }
  }
  if (result.status !== 'complete') return compose(result, false);
  return input.events.length
    ? compose(result, true)
    : { ...result, status: 'empty' };
}

/** Keep consent/evidence in the canonical workflow; fence the actual adapter start after those awaits. */
function guardCacheOwner(
  provider: LanguageModelProvider,
  cache: CalendarClassificationCache,
  generation: number,
  signal: AbortSignal,
  reprove?: () => Promise<unknown>,
): LanguageModelProvider {
  async function ensureReusedCurrent() {
    if (reprove && !(await reprove()))
      throw new Error('Cached Calendar evidence changed.');
  }
  return {
    ...provider,
    async generate(request, options) {
      if (reprove) await ensureReusedCurrent();
      const admitted = await cache.startIfCurrent(generation, signal, () => {
        if (options?.signal?.aborted)
          throw new Error('Calendar provider authorization retired.');
        const pending = provider.generate(request, options);
        pending.catch(() => undefined);
        return pending;
      });
      return admitted.value;
    },
    ...(provider.stream
      ? {
          async *stream(
            request: Parameters<LanguageModelProvider['generate']>[0],
            options?: Parameters<LanguageModelProvider['generate']>[1],
          ) {
            if (reprove) await ensureReusedCurrent();
            const admitted = await cache.startIfCurrent(
              generation,
              signal,
              () => {
                if (options?.signal?.aborted)
                  throw new Error('Calendar provider authorization retired.');
                const owned = provider.stream!(request, options)[
                  Symbol.asyncIterator
                ]();
                const first = owned.next();
                first.catch(() => undefined);
                return { owned, first };
              },
            );
            try {
              let result = await admitted.value.first;
              while (!result.done) {
                yield result.value;
                result = await admitted.value.owned.next();
              }
            } finally {
              await admitted.value.owned.return?.();
            }
          },
        }
      : {}),
  };
}
