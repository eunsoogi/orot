import {
  approvalFor,
  sourceId,
  threadId,
  time,
  sqliteEncounterFixture,
} from '../__fixtures__/sqliteFixture';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { persistEncounterApproval } from '../persistence';
import {
  runEncounterProcessingGraph,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import { createEncounterGraphPort } from '../workflow';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
} from '../syntheticFixture';

describe('Encounter source deletion privacy', () => {
  const { repository, database, pending, run } = sqliteEncounterFixture();

  it('removes recording A state while preserving recording B and prevents late checkpoint writes', async () => {
    const savedPending = await pending();
    expect((await run(false, approvalFor(savedPending)).result).status).toBe(
      'saved',
    );
    const second = sourceId + ':other';
    await seedSyntheticEncounter(repository(), second);
    const otherStorage = createLangGraphCheckpointStorage(database(), {
      sourceRecordId: second,
    });
    const other = await runEncounterProcessingGraph({
      threadId: 'other-thread',
      sourceId: second,
      checkpointer: new SqliteCheckpointSaver(otherStorage),
      port: createEncounterGraphPort(
        repository(),
        syntheticEncounterModel(second, true).model,
      ),
    });
    expect(other.status).toBe('pending');
    const a = createLangGraphCheckpointStorage(database(), {
      sourceRecordId: sourceId,
    });
    const aThread = 'encounter:' + encodeURIComponent(threadId);
    await repository().sourceRecords.delete(sourceId);
    expect(await a.listCheckpoints(aThread)).toEqual([]);
    expect(
      (await otherStorage.listCheckpoints('encounter:other-thread')).length,
    ).toBeGreaterThan(0);
    expect(await repository().get('source_record', second)).not.toBeNull();
    expect(
      await repository().getSyncCheckpoint(
        'encounter-approval:' + encodeURIComponent(threadId),
      ),
    ).toBeNull();
    await expect(
      a.saveCheckpoint(aThread, '', {
        checkpointId: 'late',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([1]),
        metadataType: 'json',
        metadata: new Uint8Array([1]),
      }),
    ).rejects.toThrow('source was removed');
  });

  it('keeps only an opaque conflict fingerprint when another source is later removed', async () => {
    const second = sourceId + ':conflicting';
    const privateText = 'PRIVATE_CONFLICT_SOURCE_B';
    await seedSyntheticEncounter(repository(), second);
    await repository().put('health_observation', {
      id: 'conflicting-plan',
      effectiveAt: time,
      recordedAt: time,
      ingestedAt: time,
      provenance: { origin: 'derived', sourceRecordIds: [second] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'other',
      concept: 'encounter_plan',
      value: { kind: 'text', text: privateText },
    });
    const current = await pending();
    expect(current.conflicts[0].version).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(current)).not.toContain(privateText);
    await repository().sourceRecords.delete(second);
    const storage = createLangGraphCheckpointStorage(database(), {
      sourceRecordId: sourceId,
    });
    const checkpoints = await storage.listCheckpoints(
      'encounter:' + encodeURIComponent(threadId),
    );
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(
      checkpoints
        .map(checkpoint => String.fromCharCode(...checkpoint.checkpoint))
        .join(''),
    ).not.toContain(privateText);
    expect((await run(false, approvalFor(current)).result).status).toBe(
      'unavailable',
    );
    expect(await repository().get('source_record', sourceId)).not.toBeNull();
  });

  it('erases pending payloads and refuses approval and checkpoint writes after logical removal', async () => {
    const current = await pending();
    const memoryStorage = new SqlCipherAgentMemoryStorage(database());
    await memoryStorage.markSourceRemoved(sourceId);
    expect(await repository().get('source_record', sourceId)).not.toBeNull();
    const storage = createLangGraphCheckpointStorage(database(), {
      sourceRecordId: sourceId,
    });
    const graphThread = 'encounter:' + encodeURIComponent(threadId);
    expect(await storage.listCheckpoints(graphThread)).toEqual([]);
    await expect(
      persistEncounterApproval(
        repository(),
        current,
        approvalFor(current),
        new AbortController().signal,
      ),
    ).rejects.toThrow('source was removed');
    await expect(
      storage.saveWrites(graphThread, '', 'late', [
        {
          taskId: 'late',
          index: 0,
          channel: 'pending',
          type: 'json',
          value: new Uint8Array([1]),
          replaceExisting: false,
        },
      ]),
    ).rejects.toThrow('source was removed');
    expect(await repository().list('health_observation')).toEqual([]);
    expect(await repository().list('evidence_span')).toEqual([]);
    expect(
      await repository().getSyncCheckpoint(
        'encounter-approval:' + encodeURIComponent(threadId),
      ),
    ).toBeNull();
    expect((await run(false, approvalFor(current)).result).status).toBe(
      'unavailable',
    );
  });
});
