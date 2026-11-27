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
  EncounterGraphOptions,
  EncounterTranscript,
} from '@orot/agent-runtime';
import { openLocalStorage } from '../../storage/secureDatabase';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import { readEncounterTranscript } from './transcript';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { persistEncounterApproval } from './persistence';
import { encounterConflicts } from './conflicts';
import {
  extractEncounterCandidates,
  InvalidEncounterCandidates,
} from './extraction';
import type { EncounterModelOptions } from './extraction';
import type { RecordRepository } from '@orot/storage';

/** Domain adapter is also used by native integration tests; persistence always goes through the app repository. */
export function createEncounterGraphPort(
  repository: RecordRepository,
  model: EncounterModelOptions,
  requireCurrentSession = false,
  onDiagnostic?: EncounterGraphOptions['onDiagnostic'],
  expectedTranscript?: EncounterTranscript,
  onRejectedCandidates?: () => void,
): EncounterGraphPort {
  const loadCurrent: EncounterGraphPort['load'] = async (sourceId, signal) => {
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
    async load(sourceId, signal) {
      const transcript = await loadCurrent(sourceId, signal);
      // Model selection and session setup can yield after the user starts review.
      // Do not let a different transcript become the input to that same action.
      if (
        expectedTranscript &&
        encounterCanonical(transcript) !==
          encounterCanonical(expectedTranscript)
      )
        throw new Error('The selected transcript changed before extraction.');
      return transcript;
    },
    async extract(transcript, signal) {
      try {
        return await extractEncounterCandidates({
          transcript,
          model,
          signal,
          onDiagnostic,
          isCurrent: async () =>
            encounterCanonical(
              await loadCurrent(transcript.sourceId, signal),
            ) === encounterCanonical(transcript),
        });
      } catch (error) {
        if (error instanceof InvalidEncounterCandidates && !signal.aborted)
          onRejectedCandidates?.();
        throw error;
      }
    },
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
  expectedTranscript?: EncounterTranscript;
  onDiagnostic?: EncounterGraphOptions['onDiagnostic'];
  onRejectedCandidates?: () => void;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const database = await openLocalAgentMemoryDatabase();
  // Open the existing marker owner before installing source-linked checkpoint cleanup triggers.
  await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds();
  const { expectedTranscript, onRejectedCandidates, ...graphInput } = input;
  return runEncounterProcessingGraph({
    ...graphInput,
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
      input.onDiagnostic,
      expectedTranscript,
      onRejectedCandidates,
    ),
  });
}

/** An invalid proposal is not a record or a recoverable checkpoint. Expose the
 * specific failure only for the same source and exact transcript that ran. */
export async function runFreshShortEncounterProcessing(
  input: Parameters<typeof runLocalEncounterProcessing>[0] & {
    expectedTranscript: EncounterTranscript;
    signal: AbortSignal;
  },
  repository: RecordRepository,
  confirm: () => Promise<boolean>,
) {
  let explicitlyRejected = false;
  const result = await runLocalEncounterProcessing({
    ...input,
    onRejectedCandidates: () => {
      explicitlyRejected = true;
    },
  });
  // Check the original native/selection lease before reading local data again.
  if (!(await confirm())) return undefined;
  if (
    result.status !== 'unavailable' ||
    !explicitlyRejected ||
    input.signal.aborted
  )
    return result;
  try {
    const exact = await repository.transaction(async (writer, sql) => {
      if (!sql || input.signal.aborted) return false;
      const current = await readEncounterTranscript(
        writer,
        sql,
        input.sourceId,
      );
      return (
        encounterCanonical(current) ===
        encounterCanonical(input.expectedTranscript)
      );
    });
    return exact && !input.signal.aborted
      ? { status: 'invalid-candidates' as const }
      : result;
  } catch {
    // Invalidated or unreadable transcript must not be described as a current proposal.
    return result;
  }
}
