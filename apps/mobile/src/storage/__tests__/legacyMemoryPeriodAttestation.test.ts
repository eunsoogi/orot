import { visitHealthFixture } from '../../agent/visitQuestions/testing/healthContextFixture';
import { healthPeriodDependencyId } from '../healthPeriodDependencies';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';
import { createResearchArtifactStorage } from '../researchArtifactStorage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';

test('opaque legacy period memories cannot borrow a current question policy; a freshly reviewed identity can', async () => {
  const f = await visitHealthFixture();
  try {
    await f.save();
    const question = (await f.records.list('visit_question'))[0]!;
    const period = healthPeriodDependencyId(question.healthContextSources![0]!);
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    await storage.listRecords();
    const record: PersistedMemoryRecord = {
      id: 'opaque-old',
      text: 'Synthetic old reviewed text',
      vector: new Float32Array([1]),
      tags: ['reviewed_interaction'],
      entities: [],
      importance: 0.5,
      createdAt: 1,
      reinforcements: 0,
      meta: {
        memoryKey: 'old',
        kind: 'reviewed_interaction',
        provenance: { sourceIds: [period], reviewState: 'human_reviewed' },
      },
    };
    await f.database.execute(
      'INSERT INTO agent_memory_records(id,record_json) VALUES (?,?)',
      [record.id, JSON.stringify({ ...record, vector: [1] })],
    );
    expect((await storage.listRecords()).map(row => row.id)).not.toContain(
      record.id,
    );
    await expect(
      storage.append({
        ...record,
        meta: {
          ...record.meta,
          provenance: {
            sourceIds: [period, question.id],
            sourceReferences: [{ kind: 'visit_question', id: question.id }],
            reviewState: 'human_reviewed',
          },
        },
      }),
    ).rejects.toThrow('parent');
    const fresh = {
      ...record,
      id: 'fresh-review',
      meta: {
        ...record.meta,
        provenance: {
          sourceIds: [period, question.id],
          sourceReferences: [{ kind: 'visit_question', id: question.id }],
          reviewState: 'human_reviewed',
        },
      },
    };
    await storage.append(fresh);
    expect((await storage.listRecords()).map(row => row.id)).toContain(
      fresh.id,
    );
    await storage.append({
      ...fresh,
      text: 'Synthetic explicitly re-reviewed text',
    });
    expect(
      (await storage.listRecords()).find(row => row.id === fresh.id)?.text,
    ).toBe('Synthetic explicitly re-reviewed text');
    const research = createResearchArtifactStorage(f.database);
    const [researchId] = await research.append(
      [
        {
          createdAt: '2026-10-05T00:00:00.000Z',
          originFeature: 'synthetic',
          providerId: null,
          modelId: null,
          generatedText: 'Synthetic',
          source: {
            kind: 'public_web_search',
            status: 'historical_snapshot',
            retrievedAt: '2026-10-05T00:00:00.000Z',
            sources: [{ title: 'Synthetic', url: 'https://example.org' }],
          },
          inputSources: [],
        },
      ],
      await research.currentGeneration(),
    );
    const mixed = {
      ...fresh,
      id: 'mixed-review',
      meta: {
        ...fresh.meta,
        provenance: {
          ...fresh.meta.provenance,
          sourceIds: [
            period,
            question.id,
            `generated-artifact:generated_research:research-${researchId}`,
          ],
        },
      },
    };
    await storage.append(mixed);
    await f.database.execute(
      "UPDATE research_period_policy SET status='quarantined' WHERE artifact_id=?",
      [researchId!],
    );
    // No intervening read has recorded memory quarantine; old parent verification must still prevent source stripping.
    await expect(
      storage.append({
        ...fresh,
        id: mixed.id,
        text: 'Synthetic replacement dropping invalid parent',
      }),
    ).rejects.toThrow('parent');
    await expect(
      storage.append({
        ...mixed,
        text: 'Synthetic replacement stripping every source',
        meta: {
          ...mixed.meta,
          provenance: { sourceIds: [], reviewState: 'human_reviewed' },
        },
      }),
    ).rejects.toThrow('parent');
    await storage.markSourceRemoved('unrelated');
    expect((await storage.listRecords()).map(row => row.id)).toContain(
      fresh.id,
    );
    expect((await storage.listRecords()).map(row => row.id)).not.toContain(
      record.id,
    );
  } finally {
    f.close();
  }
});
