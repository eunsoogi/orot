import '../agent/polyfills';
import { requireLiveCheckpointSource } from '@orot/storage';
import type {
  EncounterApproval,
  EncounterPending,
  EncounterTranscript,
} from '@orot/agent-runtime';
import {
  SqliteCheckpointSaver,
  validateEncounterApproval,
} from '@orot/agent-runtime';
import { persistEncounterApproval } from '../agent/encounter/persistence';
import { openLocalStorage } from '../storage/secureDatabase';
import {
  composeEncounterModel,
  encounterReadOnlyModel,
} from '../agent/encounter/modelComposition';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { runLocalEncounterProcessing } from '../agent/encounter/workflow';
import {
  EncounterTranscriptEmpty,
  EncounterTranscriptTooLong,
  readEncounterTranscript,
} from '../agent/encounter/transcript';
import type { EncounterReviewService, ReviewResult } from './controller';
import type { ReviewDiagnostics, ReviewDiagnosticAttempt } from './diagnostics';
import { createEncounterStartAdmission } from './startAdmission';
import { runWithEncounterNativeAdmission } from './runNativeAdmission';
import { openEncounterReviewSessions } from './openSessions';
import { createLongEncounterReview } from './longEncounterReview';
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
  const { storage, discovery } = await openEncounterReviewSessions(sourceId);
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
  const long =
    resolveSelected === resolveSelectedAiProvider
      ? createLongEncounterReview(resolveSelected)
      : undefined;
  return {
    diagnostics: observations,
    restore: (sourceId, signal) =>
      resume(sourceId, signal, undefined, observations?.current()),
    async decide(sourceId, approval, signal) {
      return (
        (await long?.decide(sourceId, approval, signal)) ??
        resume(sourceId, signal, approval, observations?.current())
      );
    },
    async start(sourceId, consent, signal, lifetime) {
      const diagnostics = observations?.current();
      diagnostics?.stage('source_lookup');
      const repository = await openLocalStorage();
      const source = await repository.get('source_record', sourceId);
      if (!source || source.sourceKind !== 'audio_recording') {
        diagnostics?.unavailable('source_lookup');
        return { status: 'unavailable' };
      }
      diagnostics?.stage('transcript_read');
      let expectedTranscript: EncounterTranscript;
      try {
        expectedTranscript = await repository.transaction(
          async (writer, sql) => {
            if (!sql) throw new Error('Canonical storage required.');
            return readEncounterTranscript(writer, sql, sourceId);
          },
        );
      } catch (error) {
        if (signal.aborted) return { status: 'cancelled' };
        if (error instanceof EncounterTranscriptEmpty)
          return { status: 'no-transcript' };
        if (!(error instanceof EncounterTranscriptTooLong)) throw error;
        if (lifetime && long)
          return long.start(sourceId, repository, consent, signal, lifetime);
        diagnostics?.unavailable('transcript_read');
        return { status: 'transcript-too-long' };
      }
      if (signal.aborted) return { status: 'cancelled' };
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
      const admission = createEncounterStartAdmission(
        selected,
        consent,
        resolveSelected === resolveSelectedAiProvider,
      );
      if (!admission.selectionCurrent()) return { status: 'unavailable' };
      return runWithEncounterNativeAdmission(
        !selected.remoteProcessing &&
          resolveSelected === resolveSelectedAiProvider,
        signal,
        admission.selectionCurrent,
        async (executionSignal, confirm) => {
          diagnostics?.stage('session_begin');
          const { discovery } = await openEncounterReviewSessions(sourceId);
          if (signal.aborted) return { status: 'cancelled' };
          if (!(await confirm()) || !admission.selectionCurrent())
            return { status: 'unavailable' };
          let session: Awaited<ReturnType<typeof discovery.begin>>;
          try {
            session = await discovery.begin(executionSignal);
          } catch (error) {
            if (signal.aborted) return { status: 'cancelled' };
            if (executionSignal.aborted) return { status: 'unavailable' };
            throw error;
          }
          if (signal.aborted) return { status: 'cancelled' };
          if (executionSignal.aborted) return { status: 'unavailable' };
          const executionId = discovery.executionId(session);
          const model = composeEncounterModel(
            sourceId,
            executionId,
            selected,
            admission.consent,
          );
          diagnostics?.stage('graph_setup');
          const result = await runLocalEncounterProcessing({
            sourceId,
            threadId: session.threadId,
            expectedTranscript,
            model,
            signal: executionSignal,
            onDiagnostic: diagnostics?.capture,
          });
          if (signal.aborted) return { status: 'cancelled' };
          if (!(await confirm())) return { status: 'unavailable' };
          diagnostics?.stage('session_readback');
          if ((await discovery.read())?.threadId !== session.threadId) {
            diagnostics?.unavailable('session_readback');
            return { status: 'unavailable' };
          }
          if (!(await confirm()) || !admission.selectionCurrent())
            return { status: 'unavailable' };
          return admission.denied() ? { status: 'consent-denied' } : result;
        },
      );
    },
  };
}
export const encounterReviewService = createEncounterReviewService();
