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
 * observer fences Stop/newer requests; transient opening text is not saved as an answer. */
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
      !validateInitialConversationResponse('살펴볼게요.', input.request)
    ) {
      reportOpening('opening_delivery', 'unavailable', input.diagnosticFeature);
      return;
    }
    const text = await generateContextualInitialReply({
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
      input.observer.onTaskStreamEvent({
        type: 'initial_response',
        callId: id,
        text,
      });
      reportOpening('opening_delivery', 'completed', input.diagnosticFeature);
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

/** Ordinary text sends retain the existing record-conversation disclosure. */
export function startRagConversationOpening(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  request: string,
  observer: RagConversationObserver | undefined,
  consent: ExecutionConsentPort,
  signal: AbortSignal,
  isEvidenceCurrent?: () => Promise<boolean>,
) {
  return startContextualConversationOpening({
    selected,
    request,
    observer,
    consent,
    signal,
    isEvidenceCurrent,
    consentScope: evidenceConsentScope({
      purpose: 'record_conversation',
      generatedArtifacts: false,
      external: false,
      publicWeb: false,
    }),
  });
}
