import type { AgentMemoryInput } from '@orot/agent-memory';
import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import {
  assertAgentMemoryRagProbeSearch,
  createAgentMemoryProbeRagVector,
} from '../../src/memory/agentMemoryRagProbe';
import {
  closeLocalAgentMemory,
  openLocalAgentMemory,
} from '../../src/memory/localAgentMemory';
import { deterministicProvider } from '../../src/memory/agentMemoryProbe';
import {
  reconcileRecordingDeletions,
  restoreRecordingDeletion,
  stageRecordingDeletion,
} from '../../src/recording/nativeRecordingBridge';
import { SqlCipherRagEmbeddingStorage } from '../../src/storage/ragEmbeddingStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../src/storage/secureDatabase';

const deletionMemoryText = '합성 전사 원문입니다.';

function chunkIdFor(sourceId: string): string {
  return `${sourceId}:transcript-deletion-chunk`;
}

/** Seeds one deterministic graph vector so deletion proof does not download an embedding model. */
export async function seedTranscriptDeletionEvidence(
  sourceId: string,
): Promise<void> {
  const database = await openLocalAgentMemoryDatabase();
  const chunkId = chunkIdFor(sourceId);
  // Seed a fresh source-linked memory after transcript correction removed its earlier revision.
  const memory = await openLocalAgentMemory(deterministicProvider);
  const memoryInput: AgentMemoryInput = {
    memoryKey: `transcript-deletion:${sourceId}`,
    text: deletionMemoryText,
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: [sourceId],
      sourceDates: [{ sourceId, date: new Date().toISOString() }],
      reviewState: 'user_confirmed',
    },
  };
  await memory.remember(memoryInput);
  if (
    (await memory.recall(deletionMemoryText, { minSimilarity: 0.999 }))
      .length !== 1
  ) {
    throw new Error('The transcript deletion memory fixture was not recalled.');
  }
  await new SqlCipherRagEmbeddingStorage(database).upsertBatch(
    LOCAL_EMBEDDING_IDENTITY,
    [
      {
        chunkId,
        vector: createAgentMemoryProbeRagVector(),
        sourceRecordIds: [sourceId],
      },
    ],
  );
  await assertAgentMemoryRagProbeSearch(database, sourceId, true, chunkId);
  // Staging must stay backup-eligible without polluting the permanent UUID-only recording scan.
  await stageRecordingDeletion(sourceId);
  await reconcileRecordingDeletions([sourceId]);
  // A second stage proves the recovery path restored the original audio before UI deletion.
  await stageRecordingDeletion(sourceId);
  await reconcileRecordingDeletions([sourceId]);
}

/** Reopens local storage after app relaunch and checks that every dependent record remains deleted. */
export async function verifyTranscriptDeletionAfterRelaunch(
  sourceId: string,
): Promise<void> {
  const repository = await openLocalStorage();
  // Recovery must use persisted recording IDs so a failed cascade restores its staged source audio.
  const liveRecordings = (await repository.list('source_record')).filter(
    source => source.sourceKind === 'audio_recording',
  );
  await reconcileRecordingDeletions(liveRecordings.map(source => source.id));
  const [source, question, segments, staleArtifacts] = await Promise.all([
    repository.get('source_record', sourceId),
    repository.get('visit_question', `${sourceId}:transcript-question`),
    repository.transcripts.listForRecording(sourceId),
    repository.transcripts.listStaleArtifacts(`${sourceId}:segment:0`),
  ]);
  if (source || question || segments.length || staleArtifacts.length) {
    throw new Error(
      'A transcript source or dependent record returned after relaunch.',
    );
  }

  const database = await openLocalAgentMemoryDatabase();
  const embeddings = new SqlCipherRagEmbeddingStorage(database);
  const chunkId = chunkIdFor(sourceId);
  const vectors = await embeddings.listForModel(LOCAL_EMBEDDING_IDENTITY);
  if (vectors.some(vector => vector.chunkId === chunkId)) {
    throw new Error('A transcript-derived vector returned after relaunch.');
  }
  await assertAgentMemoryRagProbeSearch(database, sourceId, false, chunkId);
  await assertAudioFileRemoved(sourceId);

  await closeLocalAgentMemory();
  const memory = await openLocalAgentMemory(deterministicProvider);
  try {
    if (
      (await memory.recall(deletionMemoryText, { minSimilarity: 0.999 })).length
    ) {
      throw new Error('Transcript-linked memory returned after relaunch.');
    }
  } finally {
    await closeLocalAgentMemory();
  }
}

async function assertAudioFileRemoved(sourceId: string): Promise<void> {
  try {
    await stageRecordingDeletion(sourceId);
  } catch (error) {
    // Only an explicit missing-file response proves absence; protection and I/O errors stay failures.
    if (
      (error as { code?: unknown } | null)?.code === 'RECORDING_FILE_MISSING'
    ) {
      return;
    }
    throw error;
  }
  await restoreRecordingDeletion(sourceId);
  throw new Error('The original audio file returned after relaunch.');
}
