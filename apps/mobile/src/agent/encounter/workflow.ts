import '../polyfills';
import {
  encounterCanonical,
  requireEncounterActive,
  runEncounterProcessingGraph,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import type {
  EncounterApproval,
  EncounterGraphPort,
} from '@orot/agent-runtime';
import { openLocalStorage } from '../../storage/secureDatabase';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import { readEncounterTranscript } from './transcript';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { persistEncounterApproval } from './persistence';
import { encounterConflicts } from './conflicts';
import { extractEncounterCandidates } from './extraction';
import type { EncounterModelOptions } from './extraction';
import type { RecordRepository } from '@orot/storage';

/** Domain adapter is also used by native integration tests; persistence always goes through the app repository. */
export function createEncounterGraphPort(
  repository: RecordRepository,
  model: EncounterModelOptions,
  requireCurrentSession = false,
): EncounterGraphPort {
  const load: EncounterGraphPort['load'] = async (sourceId, signal) => {
    requireEncounterActive(signal);
    const transcript = await repository.transaction(async (writer, sql) => {
      if (!sql)
        throw new Error('Encounter loading requires canonical storage.');
      return readEncounterTranscript(writer, sql, sourceId);
    });
    requireEncounterActive(signal);
    return transcript;
  };
  return {
    load,
    extract: (transcript, signal) =>
      extractEncounterCandidates({
        transcript,
        model,
        signal,
        isCurrent: async () =>
          encounterCanonical(await load(transcript.sourceId, signal)) ===
          encounterCanonical(transcript),
      }),
    conflicts: async (candidates, signal) => {
      requireEncounterActive(signal);
      const result = await encounterConflicts(repository, candidates);
      requireEncounterActive(signal);
      return result;
    },
    persist: (pending, approval, signal) =>
      persistEncounterApproval(
        repository,
        pending,
        approval,
        signal,
        requireCurrentSession,
      ),
  };
}

/** Callable graph adapter for production review and native tests. Session fencing is opt-in for the production composition. */
export async function runLocalEncounterProcessing(input: {
  threadId: string;
  sourceId: string;
  model: EncounterModelOptions;
  signal?: AbortSignal;
  approval?: EncounterApproval;
  requireCurrentReviewSession?: boolean;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const database = await openLocalAgentMemoryDatabase();
  // Open the existing marker owner before installing source-linked checkpoint cleanup triggers.
  await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds();
  return runEncounterProcessingGraph({
    ...input,
    checkpointer: new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(database, {
        sourceRecordId: input.sourceId,
      }),
    ),
    store: input.model.store,
    port: createEncounterGraphPort(
      await openLocalStorage(),
      input.model,
      input.requireCurrentReviewSession,
    ),
  });
}
