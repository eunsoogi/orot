import {
  healthContextFixture as fixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import { decodeSavedSymptomSummary } from '../../../storage/symptomSummaryStorageCodec';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';

test('deleting uncited model input removes its retained summary', async () => {
  const f = await fixture();
  try {
    await f.repository.put(
      'health_observation',
      healthObservation('uncited-steps', 'step_count', '2026-10-01T01:00:00Z'),
    );
    const report = await f.read(window, ['activity']);
    const uncited = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      report,
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'activity',
        window,
      },
    });
    const persistence = createSymptomSummaryPersistence({
      registry: f.registry,
      data: async () => ({}) as never,
      storage: async () => f.storage,
    });
    const outcome = await persistence.save(
      {
        status: 'workflow',
        result: {
          status: 'result',
          value: {
            presentation: 'symptom_summary',
            hypotheses: [
              {
                title: '심박 기록',
                summary: '심박 기록이에요.',
                uncertainty: '',
                missingData: [],
                supportingEvidence: [f.item],
                contraryEvidence: [],
              },
            ],
          },
          citations: [f.item],
          checkpoint: { evidenceReferences: [f.item, uncited] },
          coverage: [],
        },
      } as never,
      {
        provider: { id: 'synthetic' },
        modelId: 'synthetic',
        option: { displayName: 'Synthetic' },
      } as never,
      'uncited-input',
      signal,
      f.saved.createdAt,
    );
    expect(outcome).toMatchObject({
      result: { value: { savedSummary: { status: 'saved' } } },
    });
    const [saved] = await f.storage.list();
    expect(await f.storage.read(saved!.id)).toMatchObject({
      inputLineage: 'complete',
    });
    await f.repository.delete('health_observation', 'uncited-steps');
    expect(await f.storage.read(saved!.id)).toBeNull();
  } finally {
    f.close();
  }
});

test('a transcript correction removes its derived health fact from cache, current evidence and atomic save', async () => {
  const f = await fixture();
  try {
    const stale = (kind: string, id: string) =>
      f.database.execute(
        'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'synthetic-transcript',
          kind,
          id,
          'old-segment',
          'new-segment',
          '2026-10-05T00:00:00Z',
        ],
      );
    await stale('visit_question', 'unrelated-question');
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(true);
    await stale('health_observation', 'inside');
    expect((await f.read(window, ['measurements'])).quantities).toHaveLength(0);
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(false);
    await expect(f.storage.append(f.saved)).rejects.toThrow(
      'health period changed',
    );
    expect(await f.storage.list()).toHaveLength(0);
  } finally {
    f.close();
  }
});

test.each(['time', 'topic'] as const)(
  'an old period dependency is purged when an event moves out by %s before deletion',
  async change => {
    const f = await fixture();
    try {
      await f.storage.append(f.saved);
      await f.repository.put(
        'health_observation',
        change === 'time'
          ? { ...f.inside, effectiveAt: '2026-09-01T00:00:00Z' }
          : { ...f.inside, concept: 'step_count' },
      );
      expect(await f.storage.read(f.saved.id)).toBeNull();
      await f.repository.delete('health_observation', 'inside');
      expect(await f.storage.list()).toHaveLength(0);
    } finally {
      f.close();
    }
  },
);

test('out-of-period updates preserve saved results, while delete-all clears period-derived prose', async () => {
  const f = await fixture();
  try {
    await f.storage.append(f.saved);
    const outside = healthObservation(
      'outside',
      'heart_rate',
      '2026-09-01T00:00:00Z',
    );
    await f.repository.put('health_observation', outside);
    await f.repository.put('health_observation', {
      ...outside,
      value: { kind: 'quantity', amount: 60, unit: 'count/min' },
    });
    expect(await f.storage.read(f.saved.id)).not.toBeNull();
    await f.repository.deleteAllLocalData();
    expect(await f.storage.list()).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('a period locator cannot masquerade as an unchecked empty exact-record source', async () => {
  const f = await fixture();
  try {
    const invalid = {
      ...f.saved,
      sources: f.saved.sources.map(source => ({
        reference: source.reference,
        records: [],
      })),
    };
    expect(decodeSavedSymptomSummary(JSON.stringify(invalid))).toBeNull();
    await expect(f.storage.append(invalid)).rejects.toThrow('cannot be saved');
  } finally {
    f.close();
  }
});

test('deleting a provenance source also removes its derived health period summary', async () => {
  const f = await fixture('period-root-source');
  try {
    await f.storage.append(f.saved);
    await f.repository.delete('source_record', 'period-root-source');
    expect(await f.repository.get('health_observation', 'inside')).toBeNull();
    expect(await f.storage.read(f.saved.id)).toBeNull();
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(false);
  } finally {
    f.close();
  }
});
