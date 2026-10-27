import type { EvidenceBatch } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';

export const currentPeriodEnd = '2026-10-27T12:00:00.000Z';
// Keep current-period samples one millisecond inside the query's exclusive end.
export const currentPeriodSampleAt = '2026-10-27T11:59:59.999Z';

// Freeze Date reads only; timers and microtasks remain native for the real SQL path.
export async function withFixedDate<T>(
  instant: string,
  action: () => Promise<T>,
) {
  const nativeDate = globalThis.Date;
  const fixedTime = nativeDate.parse(instant);
  class FixedDate extends nativeDate {
    constructor(value?: string | number) {
      super(value ?? fixedTime);
    }

    static now() {
      return fixedTime;
    }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
  try {
    return await action();
  } finally {
    globalThis.Date = nativeDate;
  }
}

/** Place one synthetic sample inside the period and one at its exclusive end. */
export async function setCurrentPeriodBoundary(
  repository: RecordRepository,
  sourceId: string,
) {
  const included = await repository.get(
    'health_observation',
    sourceId + ':pulse:0',
  );
  const excluded = await repository.get(
    'health_observation',
    sourceId + ':pulse:1',
  );
  if (!included || !excluded) throw new Error('Missing synthetic observations');
  await repository.put('health_observation', {
    ...included,
    effectiveAt: currentPeriodSampleAt,
  });
  await repository.put('health_observation', {
    ...excluded,
    effectiveAt: currentPeriodEnd,
  });
}

export function measurementContext(batch: EvidenceBatch) {
  const prefix = 'health_context: ';
  const item = batch.items.find(
    value =>
      value.content.startsWith(prefix) &&
      (JSON.parse(value.content.slice(prefix.length)) as { topic?: string })
        .topic === 'measurements',
  );
  if (!item) throw new Error('Missing measurement context');
  return JSON.parse(item.content.slice(prefix.length)) as {
    period: { toExclusive: string };
    quantities: {
      concept: string;
      sampleCount: number;
      latest: { amount: number; occurredAt: string } | null;
    }[];
  };
}
