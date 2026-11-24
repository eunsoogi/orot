import {
  consent as scopedConsent,
  scope,
} from './conversationBackgroundProvider';
import { ragConversationFailure } from './ragConversationFailure';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import type {
  SelectedRecordingPorts,
  SelectedRecordingRunner,
} from './selectedRecordingConversation';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { RecordingClarificationReply } from '../../ragConversation/conversationRecordingClarification';
import type { HoldRecordingTime } from './selectedRecordingTimestampProof';
import { openSelectedRecordingTimeAdmission } from './selectedRecordingTimestampProof';

/** Open one locally matched recording only within the same attended send. */
export async function bindSelectedRecordingReply(
  reply: RecordingClarificationReply,
  observer: RagConversationObserver,
  request: string,
  signal: AbortSignal,
): Promise<
  | { readonly outcome: RagConversationOutcome }
  | {
      readonly attachment: NonNullable<
        RagConversationObserver['selectedRecordingTranscript']
      >;
      readonly hold: HoldRecordingTime;
    }
> {
  if (!reply.claim())
    return { outcome: { status: 'failure', kind: 'stale_evidence' } };
  const admitted = await openSelectedRecordingTimeAdmission({
    exactUserTimestamp: reply.exactUserTimestamp,
    submittedText: request,
    isCurrent: () => !signal.aborted && reply.isCurrent(),
  });
  if (admitted?.status === 'recording_selector_required')
    return {
      outcome: (await observer.recordingClarification?.stage(
        reply.recipient,
        reply.originalQuestion,
      ))
        ? { status: 'insufficient', guidance: 'recording_selector' }
        : { status: 'insufficient' },
    };
  if (admitted?.status !== 'current' || !reply.isCurrent() || signal.aborted)
    return { outcome: { status: 'failure', kind: 'stale_evidence' } };
  return {
    attachment: {
      sourceId: admitted.sourceId,
      signal,
      isCurrent: reply.isCurrent,
    },
    hold: admitted.hold,
  };
}

export function recordingReply(
  observer?: RagConversationObserver,
  entry?: import('./conversationIntent').ConversationEntryContext,
) {
  return observer?.inputOrigin === 'composer' &&
    !entry?.dailyReport &&
    (!entry || entry.intent === 'conversation')
    ? observer.recordingClarification?.reply
    : undefined;
}

export function linkRecordingAbort(
  signal: AbortSignal,
  controller: AbortController,
) {
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return () => signal.removeEventListener('abort', abort);
}

/** Route only app-owned selections through the isolated graph; never retry them as generic sends. */
export function isolateSelectedRecordingTurnWith(
  execute: SelectedRecordingRunner,
  dependencies: SelectedRecordingPorts &
    Pick<RagConversationServiceDependencies, 'consent'>,
  ordinary: Parameters<
    typeof import('./conversationRunOptions').observeConversationReceiptTiming
  >[0],
): typeof ordinary {
  return async (question, previous, signal, observer, entry) => {
    let attachment = observer?.selectedRecordingTranscript;
    const reply = recordingReply(observer, entry);
    if ((!attachment && !reply) || !observer)
      return ordinary(question, previous, signal, observer, entry);
    const request = question.trim();
    if (!request || request.length > 1000 || observer.photoInput)
      return { status: 'failure', kind: 'validation_failed' };
    const linked = scope(signal, observer);
    let revoke = () => {};
    try {
      let holdTimestamp: HoldRecordingTime | undefined;
      if (!attachment && reply) {
        const bound = await bindSelectedRecordingReply(
          reply,
          observer,
          request,
          linked.controller.signal,
        );
        if ('outcome' in bound) return bound.outcome;
        attachment = bound.attachment;
        holdTimestamp = bound.hold;
      }
      if (!attachment) return { status: 'unavailable' };
      revoke = linkRecordingAbort(attachment.signal, linked.controller);
      return await execute({
        ...dependencies,
        question: reply && holdTimestamp ? reply.originalQuestion : request,
        submittedQuestion: request,
        observer,
        attachment,
        holdTimestamp,
        recipient: holdTimestamp && reply ? reply.recipient : undefined,
        signal: linked.controller.signal,
        consent: scopedConsent(dependencies.consent, observer),
      });
    } catch (error) {
      return ragConversationFailure(
        error,
        linked.controller.signal,
        'workflow',
      );
    } finally {
      revoke();
      linked.dispose();
    }
  };
}
