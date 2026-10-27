import '../agent/polyfills';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { EncounterApproval, EncounterPending } from '@orot/agent-runtime';
import {
  SqliteCheckpointSaver,
  validateEncounterApproval,
} from '@orot/agent-runtime';
import { persistEncounterApproval } from '../agent/encounter/persistence';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { createEncounterReviewSessions } from '../agent/encounter/reviewSession';
import {
  composeEncounterModel,
  encounterReadOnlyModel,
} from '../agent/encounter/modelComposition';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { runLocalEncounterProcessing } from '../agent/encounter/workflow';
import { readEncounterTranscript } from '../agent/encounter/transcript';
import type { EncounterReviewService, ReviewResult } from './controller';

async function sessions(sourceId: string) {
  const database = await openLocalAgentMemoryDatabase();
  await new SqlCipherAgentMemoryStorage(database).listRemovedSourceIds();
  const storage = createLangGraphCheckpointStorage(database, {
    sourceRecordId: sourceId,
  });
  return {
    storage,
    discovery: createEncounterReviewSessions(storage, sourceId),
  };
}

/** Known-source discovery precedes graph invocation; missing checkpoints must never initiate extraction on restore. */
async function readSessionResult(
  sourceId: string,
  signal: AbortSignal,
  approval?: EncounterApproval,
): Promise<ReviewResult> {
  const repository = await openLocalStorage();
  await repository.transaction(async (writer, sql) => {
    if (!sql) throw new Error('Canonical storage required.');
    await requireLiveCheckpointSource(sql, sourceId);
    if (
      (await writer.get('source_record', sourceId))?.sourceKind !==
      'audio_recording'
    )
      throw new Error('Recording source unavailable.');
  });
  const { storage, discovery } = await sessions(sourceId);
  const session = await discovery.read();
  if (!session) return { status: approval ? 'unavailable' : 'idle' };
  if (approval && approval.pending.threadId !== session.threadId)
    return { status: 'unavailable' };
  const checkpoint = await new SqliteCheckpointSaver(storage).getTuple({
    configurable: {
      thread_id: 'encounter:' + encodeURIComponent(session.threadId),
    },
  });
  if (!checkpoint) return { status: 'unavailable' };
  if (approval)
    validateEncounterApproval(
      checkpoint.checkpoint.channel_values.pending as EncounterPending,
      approval,
    );
  const result = await runLocalEncounterProcessing({
    sourceId,
    threadId: session.threadId,
    signal,
    approval,
    model: encounterReadOnlyModel(sourceId),
    requireCurrentReviewSession: true,
  });
  if ((await discovery.read())?.threadId !== session.threadId)
    return { status: 'unavailable' };
  if (approval && result.status === 'saved') {
    // A completed graph is history, not proof that this caller's decision committed.
    // Revalidate the exact receipt on the canonical transaction, including for concurrent controllers.
    const recordIds = await persistEncounterApproval(
      repository,
      approval.pending,
      approval,
      signal,
      true,
    );
    return { status: 'saved', recordIds };
  }
  if (approval?.decision === 'approve' && result.status === 'denied')
    return { status: 'unavailable' };
  return result;
}

async function resume(
  sourceId: string,
  signal: AbortSignal,
  approval?: EncounterApproval,
): Promise<ReviewResult> {
  try {
    return await readSessionResult(sourceId, signal, approval);
  } catch {
    return { status: signal.aborted ? 'cancelled' : 'unavailable' };
  }
}

/** Production composition shares the selected model and consent UI, while approvals remain local explicit gestures. */
export function createEncounterReviewService(
  resolveSelected = resolveSelectedAiProvider,
): EncounterReviewService {
  return {
    restore: resume,
    decide: (sourceId, approval, signal) => resume(sourceId, signal, approval),
    async start(sourceId, consent, signal) {
      const repository = await openLocalStorage();
      const source = await repository.get('source_record', sourceId);
      if (!source || source.sourceKind !== 'audio_recording')
        return { status: 'unavailable' };
      const transcripts =
        await repository.transcripts.listForRecording(sourceId);
      if (!transcripts.length) return { status: 'no-transcript' };
      await repository.transaction(async (writer, sql) => {
        if (!sql) throw new Error('Canonical storage required.');
        await readEncounterTranscript(writer, sql, sourceId);
      });
      const selected = await resolveSelected();
      if (selected.status !== 'ready')
        return {
          status:
            selected.status === 'selection-required'
              ? 'selection-required'
              : 'unavailable',
        };
      if (signal.aborted) return { status: 'cancelled' };
      const { discovery } = await sessions(sourceId);
      const session = await discovery.begin();
      // Keep the source-bound checkpoint thread; only its verified nonce becomes the workflow ID.
      const executionId = discovery.executionId(session);
      let denied = false;
      const model = composeEncounterModel(sourceId, executionId, selected, {
        async authorize(request) {
          const result = await consent.authorize(request);
          if (result !== 'authorized') denied = true;
          return result;
        },
      });
      const result = await runLocalEncounterProcessing({
        sourceId,
        threadId: session.threadId,
        model,
        signal,
      });
      if (signal.aborted) return { status: 'cancelled' };
      if ((await discovery.read())?.threadId !== session.threadId)
        return { status: 'unavailable' };
      return denied && !signal.aborted ? { status: 'consent-denied' } : result;
    },
  };
}

export const encounterReviewService = createEncounterReviewService();
