import { projectHealthContext } from '../projection';
import { healthContextDays } from '../window';
import type { HealthContextReport, HealthMedicationProfile } from '../types';
import { createHealthContextTool } from '../../../aiFeatures/integration/healthContextTool';
import { registerHealthContextEvidence } from '../../../aiFeatures/integration/healthContextEvidence';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { jsonByteLength } from '../../../aiFeatures/integration/evidenceUtils';
import { createVisitQuestionEvidenceAliases } from '../../../agent/visitQuestions/evidenceAliases';
import {
  visitHealthFixture,
  periodWindow,
} from '../../../agent/visitQuestions/testing/healthContextFixture';
import { importedDoseEvent } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';

const medication: HealthMedicationProfile = {
  identity: 'private-synthetic-medication',
  name: '합성 예시약',
  source: 'healthkit_registration',
  scheduleRegistered: false,
  archived: false,
  taken: 2,
  skipped: 0,
  otherDoseRecords: 0,
  daysWithDoseRecords: 2,
  firstDoseAt: '2026-10-01T01:00:00Z',
  lastDoseAt: '2026-10-02T01:00:00Z',
};
function report(
  medications: readonly HealthMedicationProfile[],
  window = periodWindow,
): HealthContextReport {
  return {
    window,
    days: healthContextDays(window),
    quantities: [],
    medications,
    sleep: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 0,
    deletionGeneration: 0,
  };
}

test.each([
  [{}, 'not_registered', 'recorded_doses_in_period'],
  [{ scheduleRegistered: true }, 'registered', 'recorded_doses_in_period'],
  [
    { scheduleRegistered: undefined },
    'not_available',
    'recorded_doses_in_period',
  ],
  [{ taken: 0 }, 'not_registered', 'catalog_only'],
  [{ archived: true }, 'not_registered', 'recorded_doses_in_period'],
  [
    { source: 'current_user_confirmation', taken: 0 },
    'not_registered',
    'user_confirmed_current_use',
  ],
  [
    { source: 'prescription_record', scheduleRegistered: undefined, taken: 0 },
    'not_available',
    'prescription_only',
  ],
] as const)(
  'keeps known schedule and observed-use states distinct: %j',
  (overrides, scheduleStatus, useEvidence) => {
    const input: HealthMedicationProfile = { ...medication, ...overrides };
    const original = report([input]);
    const before = JSON.stringify(original);
    const projected = projectHealthContext(original).medications[0];
    expect(projected).toMatchObject({
      name: medication.name,
      taken: input.taken,
      archived: input.archived,
      scheduleStatus,
      useEvidence,
      firstDoseAt: medication.firstDoseAt,
      lastDoseAt: medication.lastDoseAt,
    });
    expect(projected).not.toHaveProperty('identity');
    expect(JSON.stringify(original)).toBe(before);
  },
);

test('passes actual dose events and a known absent schedule through SQLite, the period source and provider aliases', async () => {
  const f = await visitHealthFixture('medications');
  try {
    const definition = await f.records.get(
      'medication_definition',
      'medication-1',
    );
    if (!definition) throw new Error('Synthetic registration is missing.');
    await f.records.put('medication_definition', {
      ...definition,
      hasSchedule: false,
    });
    await f.records.put('dose_event', {
      ...importedDoseEvent('second-taken', '2026-10-02T01:00:00Z', 'taken'),
      ingestedAt: '2026-10-02T02:00:00Z',
    });
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'medications' as const,
      window: periodWindow,
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const item = registerHealthContextEvidence({
      registry,
      read: f.read,
      scope,
      report: await f.read(periodWindow, ['medications']),
    });
    const original = registry.resolve(item)!;
    const aliased = createVisitQuestionEvidenceAliases({
      items: [{ ...original, content: item.content }],
      coverage: [],
      conflicts: [],
    }).batch.items[0]!;
    const content = JSON.parse(
      aliased.content.slice('health_context: '.length),
    );
    expect(content.medications[0]).toMatchObject({
      scheduleRegistered: false,
      scheduleStatus: 'not_registered',
      useEvidence: 'recorded_doses_in_period',
      taken: 2,
      skipped: 0,
      daysWithDoseRecords: 2,
      firstDoseAt: '2026-10-01T01:00:00Z',
      lastDoseAt: '2026-10-02T01:00:00Z',
    });
    expect(content.statisticSemantics).toHaveProperty('scheduleStatus');
    expect(content.statisticSemantics).toHaveProperty('useEvidence');
    expect(aliased.content).not.toContain('medication-1');
    expect(
      await registry.revalidateEvidence([item], new AbortController().signal),
    ).toBe(true);
  } finally {
    f.close();
  }
});

test.each([800, 20_480])(
  'keeps enriched medication evidence within the selected payload budget: %d',
  async maxPayloadBytes => {
    const registry = new LocalEvidenceReferenceRegistry();
    const tool = createHealthContextTool(
      async window =>
        report(
          Array.from({ length: 32 }, (_, index) => ({
            ...medication,
            identity: `private-medication-${index}`,
            name: `합성 약 ${index}`,
          })),
          window,
        ),
      registry,
    );
    const result = await tool.search({
      input: { topics: ['medications'] },
      operationRunId: 'synthetic-medication-context',
      operationKey: 'selected-period',
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 1,
      maxPayloadBytes,
      signal: new AbortController().signal,
    });
    if ('status' in result)
      throw new Error('Expected bounded period evidence.');
    expect(jsonByteLength(result)).toBeLessThanOrEqual(maxPayloadBytes);
    expect(result.items).toHaveLength(maxPayloadBytes === 800 ? 0 : 1);
    if (maxPayloadBytes === 800)
      expect(result.coverage[0]?.gaps).toContain(
        'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
      );
    else expect(result.items[0]?.content).toContain('recorded_doses_in_period');
  },
);
