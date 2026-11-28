import {
  approvedAuthoredContextualOpening,
  type AuthoredContextualOpeningProof,
} from '../../ragConversation/contextualOpeningApproval';
import { reportOpening } from './openingObservation';
import type { Feature } from '../../providers/diagnosticTypes';
import { evidenceConsentScope } from './evidenceConsentScope';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  generateContextualInitialReply,
} from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  MultiAgentExecutionIdentity,
} from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/service';
import { validateInitialConversationResponse } from '../../ragConversation/initialResponse';
import type { SelectedAiResolution } from './provider';
import { operationRunId } from './featureRunIdentity';

/** Start only at a new live send boundary, never cold workflow restoration. The owning
 * observer fences Stop/newer requests; reviewed opening text is never saved as an answer. */
export function startContextualConversationOpening(input: {
  selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  request: string;
  observer?: RagConversationObserver;
  consent: ExecutionConsentPort;
  consentScope: MultiAgentExecutionIdentity['consentScope'];
  allowedScope?: MultiAgentExecutionIdentity['allowedScope'];
  signal: AbortSignal;
  isCurrent?: () => boolean;
  isEvidenceCurrent?: () => Promise<boolean>;
  diagnosticFeature?: Feature;
  allowA2UIPresentation?: boolean;
  authoredContext?: AuthoredContextualOpeningProof;
}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  input.signal.addEventListener('abort', stop, { once: true });
  if (input.signal.aborted) stop();
  const id = operationRunId();
  const done = (async () => {
    // Keep photo-specific consent and urgent-response latency unchanged.
    if (
      !input.observer?.onTaskStreamEvent ||
      input.observer.photoInput ||
      input.observer.suppressContextualOpening ||
      !validateInitialConversationResponse('살펴볼게요.', input.request)
    ) {
      reportOpening('opening_delivery', 'unavailable', input.diagnosticFeature);
      return;
    }
    let presentation: 'card' | undefined;
    let deliverBy = 0;
    const text = await generateContextualInitialReply({
      onApprovedProcessingBudget(value) {
        deliverBy = Date.now() + (value ?? 10_000);
      },
      ...(input.allowA2UIPresentation && input.observer.onReviewedOpening
        ? {
            onApprovedPresentation: (layout: 'card') => {
              presentation = layout;
            },
          }
        : {}),
      onObservation: (stage, outcome) =>
        reportOpening(stage, outcome, input.diagnosticFeature),
      provider: input.selected.provider,
      execution: {
        operationRunId: id,
        providerId: input.selected.provider.id,
        modelId: input.selected.modelId,
        recipient: input.selected.recipient,
        remoteProcessing: input.selected.remoteProcessing,
        consentScope: input.consentScope,
        allowedScope: input.allowedScope ?? {
          sourceKinds: ['personal_record', 'reviewed_memory'],
        },
        budget: DEFAULT_MULTI_AGENT_BUDGET,
      },
      consent: input.consent,
      request: input.request,
      signal: controller.signal,
      validate: validateInitialConversationResponse,
      isCurrent: input.isEvidenceCurrent,
    });
    if (text && !controller.signal.aborted && (input.isCurrent?.() ?? true)) {
      const opening = { callId: id, text };
      const deliver = input.observer.onReviewedOpening;
      if (deliver) {
        const display = {
          ...opening,
          ...(presentation ? { presentation } : {}),
        };
        // This producer passes only the current authored input into the
        // prompt-only runner and its independent review. Neither app history nor
        // evidence/tools enter these payloads. The provider is not provenance.
        const approved = input.authoredContext
          ? approvedAuthoredContextualOpening(display, input.authoredContext)
          : display;
        const outcome = await deliverReviewedOpening(
          controller,
          deliverBy - Date.now(),
          () => deliver(approved, controller.signal),
        );
        reportOpening('opening_delivery', outcome, input.diagnosticFeature);
      } else {
        input.observer.onTaskStreamEvent({
          type: 'initial_response',
          ...opening,
        });
        reportOpening('opening_delivery', 'completed', input.diagnosticFeature);
      }
    } else if (text) {
      reportOpening(
        'opening_delivery',
        controller.signal.aborted ? 'cancelled' : 'stale_evidence',
        input.diagnosticFeature,
      );
    }
  })().catch(() =>
    reportOpening('opening_delivery', 'failed', input.diagnosticFeature),
  );
  return {
    done,
    dispose() {
      stop();
      input.signal.removeEventListener('abort', stop);
    },
  };
}

/** The optional opening journal must commit before display, but it cannot
 * indefinitely delay the grounded answer. Expiry retires only this preview. */
async function deliverReviewedOpening(
  controller: AbortController,
  remainingMs: number,
  deliver: () => Promise<boolean>,
) {
  const { signal } = controller;
  if (signal.aborted) return 'cancelled';
  if (remainingMs <= 0) {
    controller.abort();
    return 'timeout';
  }
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, remainingMs);
  let stop = () => {};
  const cancelled = new Promise<false>(resolve => {
    stop = () => resolve(false);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const published = await Promise.race([deliver(), cancelled]);
    return signal.aborted
      ? timedOut
        ? 'timeout'
        : 'cancelled'
      : published
        ? 'completed'
        : 'unavailable';
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', stop);
  }
}

/** Ordinary text sends retain the existing record-conversation disclosure. */
export function startRagConversationOpening(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  request: string,
  observer: RagConversationObserver | undefined,
  consent: ExecutionConsentPort,
  signal: AbortSignal,
  isEvidenceCurrent?: () => Promise<boolean>,
  allowA2UIPresentation = false,
  ordinaryComposer = false,
) {
  const requestId = observer?.retentionRequestId;
  const lease = observer?.retentionSession;
  const expected = observer?.expectedConversationModel;
  const authoredContext =
    ordinaryComposer &&
    observer?.inputOrigin === 'composer' &&
    requestId &&
    lease &&
    !observer.photoInput &&
    !observer.selectedRecordingTranscript &&
    !observer.expectedVoiceSelection &&
    !observer.protectedLocalInput &&
    !isEvidenceCurrent
      ? {
          input: request,
          requestId,
          sessionId: lease.id,
          sessionVersion: lease.version,
          current: () =>
            !signal.aborted &&
            (!expected ||
              (expected.providerId === selected.selection.providerId &&
                expected.modelId === selected.selection.modelId &&
                expected.isCurrent?.() !== false)),
        }
      : undefined;
  return startContextualConversationOpening({
    selected,
    request,
    observer,
    consent,
    signal,
    isEvidenceCurrent,
    allowA2UIPresentation,
    authoredContext,
    consentScope: evidenceConsentScope({
      purpose: 'record_conversation',
      generatedArtifacts: false,
      external: false,
      publicWeb: false,
    }),
  });
}
