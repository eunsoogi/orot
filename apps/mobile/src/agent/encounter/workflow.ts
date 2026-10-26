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
import { currentEncounterTranscript } from './transcript';
import { persistEncounterApproval } from './persistence';
import { encounterConflicts } from './conflicts';
import { extractEncounterCandidates } from './extraction';
import type { EncounterModelOptions } from './extraction';
import type { RecordRepository } from '@orot/storage';

/** Domain adapter is also used by native integration tests; persistence always goes through the app repository. */
export function createEncounterGraphPort(
  repository: RecordRepository,
  model: EncounterModelOptions,
): EncounterGraphPort {
  const load: EncounterGraphPort['load'] = async (sourceId, signal) => {
    requireEncounterActive(signal);
    const source = await repository.get('source_record', sourceId);
    if (!source || source.sourceKind !== 'audio_recording')
      throw new Error('Recording unavailable.');
    const transcript = currentEncounterTranscript(
      sourceId,
      await repository.transcripts.listForRecording(sourceId),
    );
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
      persistEncounterApproval(repository, pending, approval, signal),
  };
}

/** Callable app contract for extraction and restart-safe review. Screen composition remains a separate owner. */
export async function runLocalEncounterProcessing(input: {
  threadId: string;
  sourceId: string;
  model: EncounterModelOptions;
  signal?: AbortSignal;
  approval?: EncounterApproval;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  return runEncounterProcessingGraph({
    ...input,
    checkpointer: new SqliteCheckpointSaver(
      createLangGraphCheckpointStorage(await openLocalAgentMemoryDatabase(), {
        sourceRecordId: input.sourceId,
      }),
    ),
    store: input.model.store,
    port: createEncounterGraphPort(await openLocalStorage(), input.model),
  });
}
