import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  providerObservationEvidence,
  providerRecordFacts,
  providerJsonContent,
} from '../providerObservationEvidence';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceRepository';

function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const deleted = new Set<string>();
  const records: LocalHealthEvidenceRecord[] = [70, 85, 100].map(
    (amount, index) => ({
      kind: 'health_observation',
      record: {
        ...healthObservation(
          `sample-${index}`,
          'heart_rate',
          `2026-10-01T1${index}:00:00Z`,
        ),
        value: { kind: 'quantity', amount, unit: 'count/min' },
      },
    }),
  );
  const items = records.map(row =>
    registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: row.record.id,
        evidenceId: row.record.id,
        sourceRevision: '1',
        evidenceRevision: '1',
        locator: {
          kind: 'local_record',
          recordKind: row.kind,
          recordId: row.record.id,
        },
        effectiveTime: null,
        reviewState: 'unreviewed',
      },
      content: `raw sample ${JSON.stringify(row.record)}`,
      validate: async () => !deleted.has(row.record.id),
      readSource: async () =>
        deleted.has(row.record.id)
          ? { status: 'missing' }
          : {
              status: 'available',
              document: { sourceKind: 'personal_record', records: [row] },
            },
    }),
  );
  return {
    registry,
    deleted,
    records,
    items,
    rows: new Map(
      items.map((item, index) => [item.evidenceId, records[index]!]),
    ),
  };
}

test('bulk projection binds every source while keeping sample arrays local and original UI documents intact', async () => {
  const f = fixture();
  const items = providerObservationEvidence(f.items, f.rows, f.registry);
  expect(items).toHaveLength(1);
  expect(items[0]!.content).toContain('"sampleCount":3');
  expect(items[0]!.content).toContain('"mean":85');
  expect(items[0]!.content).not.toContain('raw sample');
  expect(items[0]!.content).not.toContain('11:00:00');
  const signal = new AbortController().signal;
  expect(await f.registry.readSource(items[0]!, signal)).toEqual({
    status: 'available',
    document: { sourceKind: 'personal_record', records: f.records },
  });
  expect(await f.registry.revalidateEvidence(items, signal)).toBe(true);
  f.deleted.add('sample-1');
  expect(await f.registry.revalidateEvidence(items, signal)).toBe(false);
});

test('a single model-selected sample still aggregates, while an explicit host-bound record can stay exact', () => {
  const f = fixture();
  expect(
    providerObservationEvidence([f.items[0]!], f.rows, f.registry)[0]!.content,
  ).toContain('sensor_period_summary');
  expect(
    providerObservationEvidence([f.items[0]!], f.rows, f.registry, 'sample-0'),
  ).toEqual([f.items[0]]);
});

test('non-series clinical narrative is not reclassified or altered by sensor projection', () => {
  const f = fixture();
  const narrative: LocalHealthEvidenceRecord = {
    kind: 'health_observation',
    record: {
      ...healthObservation('diagnosis', 'diagnosis', '2026-10-01T00:00:00Z'),
      observationKind: 'diagnosis',
      value: { kind: 'text', text: 'Exact synthetic clinical narrative' },
    },
  };
  const original = {
    ...f.items[0]!,
    content: 'Exact synthetic clinical narrative',
  };
  expect(
    providerObservationEvidence(
      [original],
      new Map([[original.evidenceId, narrative]]),
      f.registry,
    ),
  ).toEqual([original]);
  const facts = providerRecordFacts([...f.records, narrative]);
  expect(facts.sensorSummaries).toHaveLength(1);
  expect(JSON.stringify(facts.records)).toContain(
    'Exact synthetic clinical narrative',
  );
});

test('typed provider serialization preserves statistics equal to numeric local identifiers', () => {
  const registry = new LocalEvidenceReferenceRegistry();
  registry.registerSensitiveIdentifier('85');
  const projected = JSON.parse(
    providerJsonContent(registry, {
      mean: 85,
      sampleCount: 85,
      description: 'identifier 85',
    }),
  );
  expect(projected.mean).toBe(85);
  expect(projected.sampleCount).toBe(85);
  expect(projected.description).not.toContain('85');
});
