import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { restoreSymptomSummary } from '../symptomSummarySources';
import type { AiFeatureLocalData } from '../localData';
import {
  healthContextFixture as fixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';

test('removes period dependency metadata even when the connection has foreign keys disabled', async () => {
  const f = await fixture();
  try {
    await f.database.execute('PRAGMA foreign_keys = OFF');
    await f.storage.append(f.saved);
    expect(
      (
        await f.database.execute(
          'SELECT count(*) AS count FROM symptom_summary_periods',
        )
      ).rows[0]?.count,
    ).toBe(1);
    await f.repository.delete('health_observation', 'inside');
    expect(await f.storage.list()).toHaveLength(0);
    expect(
      (
        await f.database.execute(
          'SELECT count(*) AS count FROM symptom_summary_periods',
        )
      ).rows[0]?.count,
    ).toBe(0);
  } finally {
    f.close();
  }
});

test('restores a fixed period into a fresh registry and removes saved derived prose after in-period deletion', async () => {
  const f = await fixture();
  try {
    await f.storage.append(f.saved);
    const saved = (await f.storage.read(f.saved.id))!;
    const fresh = new LocalEvidenceReferenceRegistry();
    // Consume e1 in the fresh turn: persisted aliases must not accidentally address this unrelated source.
    registerHealthContextEvidence({
      registry: fresh,
      read: f.read,
      report: await f.read(window, ['sleep']),
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'sleep',
        window,
      },
    });
    const restored = await restoreSymptomSummary(saved, fresh, {
      readHealthContext: f.read,
    } as AiFeatureLocalData);
    expect(restored.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
    });
    const ref = restored.hypotheses[0]!.supportingEvidence[0]!;
    expect(ref.evidenceId).toBe('e2');
    const source = await fresh.readSource(ref, signal);
    expect(source.status).toBe('available');
    if (
      source.status !== 'available' ||
      source.document.sourceKind !== 'health_context_period'
    )
      throw new Error('Missing computed source');
    expect(source.document.scope.window).toEqual(window);
    await f.repository.put('health_observation', {
      ...healthObservation('outside', 'heart_rate', '2026-09-01T00:00:00Z'),
    });
    await f.repository.delete('health_observation', 'outside');
    expect(await f.storage.read(f.saved.id)).not.toBeNull();
    const afterUnrelatedDelete = await restoreSymptomSummary(
      saved,
      new LocalEvidenceReferenceRegistry(),
      { readHealthContext: f.read } as AiFeatureLocalData,
    );
    expect(afterUnrelatedDelete.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
    });
    await f.repository.delete('health_observation', 'inside');
    expect(await f.storage.read(f.saved.id)).toBeNull();
    expect(await f.storage.list()).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('rejects a source mutation before append atomically, without a partially saved run', async () => {
  const f = await fixture();
  try {
    await f.repository.put('health_observation', {
      ...f.inside,
      value: { kind: 'quantity', amount: 81, unit: 'count/min' },
    });
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(false);
    await expect(f.storage.append(f.saved)).rejects.toThrow(
      'health period changed',
    );
    expect(await f.storage.list()).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('delete and identical replacement still fence an in-flight result even when the statistics match', async () => {
  const f = await fixture();
  try {
    await f.repository.delete('health_observation', 'inside');
    await f.repository.put('health_observation', f.inside);
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(false);
    await expect(f.storage.append(f.saved)).rejects.toThrow(
      'health period changed',
    );
  } finally {
    f.close();
  }
});
