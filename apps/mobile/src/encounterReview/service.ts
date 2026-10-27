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
import type { ReviewDiagnostics, ReviewDiagnosticAttempt } from './diagnostics';

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
  diagnostics?: ReviewDiagnosticAttempt,
): Promise<ReviewResult> {
  diagnostics?.stage('source_lookup');
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
  diagnostics?.stage('session_read');
  const { storage, discovery } = await sessions(sourceId);
  const session = await discovery.read();
  if (!session) {
    if (approval) diagnostics?.unavailable('session_read');
    return { status: approval ? 'unavailable' : 'idle' };
  }
  if (approval && approval.pending.threadId !== session.threadId) {
    diagnostics?.unavailable('session_read');
    return { status: 'unavailable' };
  }
  diagnostics?.stage('checkpoint_lookup');
  const checkpoint = await new SqliteCheckpointSaver(storage).getTuple({
    configurable: {
      thread_id: 'encounter:' + encodeURIComponent(session.threadId),
    },
  });
  if (!checkpoint) {
    diagnostics?.unavailable('checkpoint_lookup');
    return { status: 'unavailable' };
  }
  if (approval)
    validateEncounterApproval(
      checkpoint.checkpoint.channel_values.pending as EncounterPending,
      approval,
    );
  diagnostics?.stage('graph_setup');
  const result = await runLocalEncounterProcessing({
    sourceId,
    threadId: session.threadId,
    signal,
    approval,
    model: encounterReadOnlyModel(sourceId),
    requireCurrentReviewSession: true,
    onDiagnostic: diagnostics?.capture,
  });
  diagnostics?.stage('session_readback');
  if ((await discovery.read())?.threadId !== session.threadId) {
    diagnostics?.unavailable('session_readback');
    return { status: 'unavailable' };
  }
  if (approval && result.status === 'saved') {
    // A completed graph is history, not proof that this caller's decision committed.
    // Revalidate the exact receipt on the canonical transaction, including for concurrent controllers.
    diagnostics?.stage('approval_receipt');
    const recordIds = await persistEncounterApproval(
      repository,
      approval.pending,
      approval,
      signal,
      true,
    );
    return { status: 'saved', recordIds };
  }
  if (approval?.decision === 'approve' && result.status === 'denied') {
    diagnostics?.unavailable('approval_receipt');
    return { status: 'unavailable' };
  }
  return result;
}

async function resume(
  sourceId: string,
  signal: AbortSignal,
  approval?: EncounterApproval,
  diagnostics?: ReviewDiagnosticAttempt,
): Promise<ReviewResult> {
  try {
    return await readSessionResult(sourceId, signal, approval, diagnostics);
  } catch (error) {
    diagnostics?.caught(error);
    return { status: signal.aborted ? 'cancelled' : 'unavailable' };
  }
}

/** Production composition shares the selected model and consent UI, while approvals remain local explicit gestures. */
export function createEncounterReviewService(
  resolveSelected = resolveSelectedAiProvider,
  observations?: ReviewDiagnostics,
): EncounterReviewService {
  return {
    diagnostics: observations,
    restore: (sourceId, signal) =>
      resume(sourceId, signal, undefined, observations?.current()),
    decide: (sourceId, approval, signal) =>
      resume(sourceId, signal, approval, observations?.current()),
    async start(sourceId, consent, signal) {
      const diagnostics = observations?.current();
      diagnostics?.stage('source_lookup');
      const repository = await openLocalStorage();
      const source = await repository.get('source_record', sourceId);
      if (!source || source.sourceKind !== 'audio_recording') {
        diagnostics?.unavailable('source_lookup');
        return { status: 'unavailable' };
      }
      diagnostics?.stage('transcript_list');
      const transcripts =
        await repository.transcripts.listForRecording(sourceId);
      if (!transcripts.length) return { status: 'no-transcript' };
      diagnostics?.stage('transcript_read');
      await repository.transaction(async (writer, sql) => {
        if (!sql) throw new Error('Canonical storage required.');
        await readEncounterTranscript(writer, sql, sourceId);
      });
      diagnostics?.stage('provider_selection');
      const selected = await resolveSelected();
      if (selected.status !== 'ready') {
        if (selected.status !== 'selection-required')
          diagnostics?.unavailable('provider_selection');
        return {
          status:
            selected.status === 'selection-required'
              ? 'selection-required'
              : 'unavailable',
        };
      }
      if (signal.aborted) return { status: 'cancelled' };
      diagnostics?.stage('session_begin');
      const { discovery } = await sessions(sourceId);
      const session = await discovery.begin();
      let denied = false;
      const model = composeEncounterModel(
        sourceId,
        session.threadId,
        selected,
        {
          async authorize(request) {
            const result = await consent.authorize(request);
            if (result !== 'authorized') denied = true;
            return result;
          },
        },
      );
      diagnostics?.stage('graph_setup');
      const result = await runLocalEncounterProcessing({
        sourceId,
        threadId: session.threadId,
        model,
        signal,
        onDiagnostic: diagnostics?.capture,
      });
      if (signal.aborted) return { status: 'cancelled' };
      diagnostics?.stage('session_readback');
      if ((await discovery.read())?.threadId !== session.threadId) {
        diagnostics?.unavailable('session_readback');
        return { status: 'unavailable' };
      }
      return denied && !signal.aborted ? { status: 'consent-denied' } : result;
    },
  };
}

export const encounterReviewService = createEncounterReviewService();
