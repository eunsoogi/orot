import { assertRetainedRecordsCurrent } from '../retainedRecordFreshness';
import { createManualHistoryRepository } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createAgentMemory } from '@orot/agent-memory';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';
import { createResearchArtifactStorage } from '../researchArtifactStorage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';

test('reviewed memory is quarantined with its exact parent without deleting the original', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const before = (
      await f.database.execute('SELECT * FROM research_artifacts WHERE id=1')
    ).rows[0]!;
    await f.repository.delete('health_observation', 'candidate');
    await f.database.execute(
      'INSERT INTO research_artifacts(id,snapshot_json,search_text) VALUES (?,?,?)',
      [1, before.snapshot_json!, before.search_text!],
    );
    // The old missing contributor guard never deleted the parent or emitted its derived tombstone.
    await f.database.execute(
      "DELETE FROM agent_memory_removed_sources WHERE source_id='generated-artifact:generated_research:research-1'",
    );
    const research = createResearchArtifactStorage(f.database);
    expect(await research.read(1)).toBeNull();
    await f.database.execute(
      'DELETE FROM research_period_policy WHERE artifact_id=1',
    );
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    await storage.listRecords();
    const record: PersistedMemoryRecord = {
      id: 'old-memory',
      text: 'Synthetic reviewed private result',
      vector: new Float32Array([1]),
      tags: ['reviewed_interaction'],
      entities: [],
      importance: 0.5,
      createdAt: 1,
      reinforcements: 0,
      meta: {
        memoryKey: 'old-memory',
        kind: 'reviewed_interaction',
        provenance: {
          sourceIds: ['generated-artifact:generated_research:research-1'],
          sourceDates: [],
          reviewState: 'human_reviewed',
        },
      },
    };
    await f.database.execute(
      'INSERT INTO agent_memory_records(id,record_json) VALUES (?,?)',
      [record.id, JSON.stringify({ ...record, vector: [1] })],
    );
    expect(await storage.listRecords()).toEqual([]);
    await expect(
      assertRetainedRecordsCurrent(
        f.database,
        [
          {
            kind: 'reviewed_memory',
            id: record.id,
            revision: fingerprint({ text: record.text, meta: record.meta }),
          },
        ],
        createManualHistoryRepository(f.database),
      ),
    ).rejects.toThrow('parent');
    expect(
      (
        await f.database.execute(
          'SELECT id FROM agent_memory_records WHERE id=?',
          [record.id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(await storage.listUnavailableMetadata()).toEqual([
      {
        id: record.id,
        createdAt: 1,
        reason: 'unverifiable_parent',
        recovery: 'review_again',
      },
    ]);
    await storage.compact([]);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM agent_memory_records WHERE id=?',
          [record.id],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      storage.append({ ...record, id: 'new-but-same-invalid-parent' }),
    ).rejects.toThrow('parent');
    await storage.append({
      ...record,
      id: 'unrelated-review',
      meta: {
        ...record.meta,
        provenance: {
          sourceIds: ['unrelated-source'],
          reviewState: 'human_reviewed',
        },
      },
    });
    expect((await storage.listRecords()).map(row => row.id)).toEqual([
      'unrelated-review',
    ]);
    await storage.markSourceRemoved(
      'generated-artifact:generated_research:research-1',
    );
    expect(
      (
        await f.database.execute(
          'SELECT id FROM agent_memory_records WHERE id=?',
          [record.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await f.database.execute(
          'SELECT memory_id FROM memory_parent_quarantine WHERE memory_id=?',
          [record.id],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('an already-open recall engine refreshes parent quarantine without erasing its stored original', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  const storage = new SqlCipherAgentMemoryStorage(f.database);
  const memory = await createAgentMemory({
    storage,
    embedder: {
      embed: async (texts: string[]) =>
        texts.map(() => new Float32Array([1, 0])),
    },
  });
  try {
    await memory.remember({
      memoryKey: 'live',
      kind: 'reviewed_interaction',
      text: 'Synthetic current research',
      provenance: {
        sourceIds: ['generated-artifact:generated_research:research-1'],
        reviewState: 'human_reviewed',
      },
    });
    expect(await memory.recall('research', { minSimilarity: 0 })).toHaveLength(
      1,
    );
    await f.database.execute(
      "UPDATE research_period_policy SET status='quarantined' WHERE artifact_id=1",
    );
    expect(await memory.recall('research', { minSimilarity: 0 })).toEqual([]);
    expect(
      (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(1);
    await memory.close();
    expect(
      (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('reviewed text derived from an exact quarantined tool turn is hidden without affecting another parent', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const storage = new SqlCipherAgentMemoryStorage(f.database);
    const memory = await createAgentMemory({
      storage,
      embedder: {
        embed: async (texts: string[]) =>
          texts.map(() => new Float32Array([1, 0])),
      },
    });
    await memory.remember({
      memoryKey: 'tool-review',
      kind: 'reviewed_interaction',
      text: 'Synthetic tool review',
      provenance: {
        sourceIds: ['generated-artifact:generated_conversation:turn'],
        reviewState: 'human_reviewed',
      },
    });
    await f.database.execute(
      "UPDATE tool_period_policy SET status='quarantined' WHERE session_id='session'",
    );
    expect(await storage.listRecords()).toEqual([]);
    expect(await storage.listUnavailableMetadata()).toHaveLength(1);
    await memory.close();
    expect(
      (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});
