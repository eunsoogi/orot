import type { EvidenceSourceDocument } from '../src/aiFeatures/integration/evidenceSourceDocument';
import { healthContextDays } from '../src/healthEvidence/healthContext/window';

const window = {
  fromInclusive: '2026-10-01T00:00:00+09:00',
  toExclusive: '2026-10-04T00:00:00+09:00',
  timeZone: 'Asia/Seoul',
};
const at = '2026-10-02T08:00:00+09:00';

/** Declared synthetic calculated facts exercise the period renderer, not provider generation or storage retrieval. */
export const evidenceVisualPeriod = {
  sourceKind: 'health_context_period',
  scope: {
    kind: 'health_context_period',
    version: 1,
    topic: 'measurements',
    window,
  },
  report: {
    window,
    days: healthContextDays(window),
    quantities: (
      [
        ['heart_rate', 'count/min', 72],
        ['body_mass', 'kg', 70.5],
      ] as const
    ).map(([concept, unit, amount]) => ({
      concept,
      unit,
      source: 'synthetic-watch',
      days: [
        {
          date: '2026-10-02',
          samples: 1,
          minimum: amount,
          maximum: amount,
          mean: amount,
          sum: amount,
          latest: amount,
          firstAt: at,
          lastAt: at,
        },
      ],
    })),
    medications: [],
    sleep: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 1,
    deletionGeneration: 0,
  },
} satisfies EvidenceSourceDocument;
