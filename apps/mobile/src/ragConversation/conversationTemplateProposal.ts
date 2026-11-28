import {
  DEFAULT_MULTI_AGENT_BUDGET,
  generateConversationTemplateProposal,
} from '@orot/agent-runtime';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { RagConversationObserver } from './conversationObserver';
import { requestsArtifactContinuation } from './artifactContinuation';
import { isRagConversationAvailabilityQuestion } from './availabilityIntent';
import { validateInitialConversationResponse } from './initialResponse';
import { conversationReceiptSelection } from '../aiFeatures/integration/conversationReceiptSelection';
import { evidenceConsentScope } from '../aiFeatures/integration/evidenceConsentScope';
import { operationRunId } from '../aiFeatures/integration/featureRunIdentity';
import { createLinkedAbortController } from '../aiFeatures/integration/linkedAbortController';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';

/**
 * Replace the optional opening only for a live, owned composer turn.
 */
export async function proposeConversationTemplate(input: {
  question: string;
  signal: AbortSignal;
  observer?: RagConversationObserver;
  select: () => Promise<SelectedAiResolution>;
  consent: ExecutionConsentPort;
}) {
  const { question, signal, observer } = input;
  const admission = observer?.modelTemplateAdmission;
  const owner = observer?.templateProposalOwner;
  if (
    !admission ||
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    !observer.retentionRequestId ||
    !owner?.current() ||
    !observer.onTaskStreamEvent ||
    signal.aborted ||
    !admission.current() ||
    !validateInitialConversationResponse('살펴볼게요.', question) ||
    isRagConversationAvailabilityQuestion(question) ||
    (observer.artifactContinuation && requestsArtifactContinuation(question))
  )
    return;
  const linked = createLinkedAbortController(signal);
  let spent = false;
  let ownerChanged = false;
  let unwatch: (() => void) | undefined;
  let stopWaiting: (() => void) | undefined;
  try {
    const current = () =>
      !linked.controller.signal.aborted &&
      admission.current() &&
      owner.current();
    unwatch = owner.watch(() => {
      ownerChanged = true;
      linked.controller.abort();
    });
    const retired = new Promise<undefined>(resolve => {
      const stop = () => resolve(undefined);
      linked.controller.signal.addEventListener('abort', stop, { once: true });
      stopWaiting = () =>
        linked.controller.signal.removeEventListener('abort', stop);
      if (linked.controller.signal.aborted) stop();
    });
    const propose = async () => {
      if (!current()) return;
      const live = await input.select();
      if (
        live.status === 'ready' &&
        (live.provider.id !== owner.providerId ||
          live.modelId !== owner.modelId)
      ) {
        if (!linked.controller.signal.aborted) ownerChanged = true;
        return;
      }
      const selected = conversationReceiptSelection(live, {
        expectedConversationModel: {
          ...owner,
          isCurrent: current,
          isDurablyCurrent: async () => {
            const stillOwned =
              current() &&
              (await owner.recheck(linked.controller.signal)) &&
              current();
            if (!stillOwned && !linked.controller.signal.aborted)
              ownerChanged = true;
            return stillOwned;
          },
        },
        // Count only actual provider entry after the durable owner recheck.
        // A refused preflight cannot suppress the ordinary reviewed opening.
        onProviderExecution: () => {
          spent = true;
          return undefined;
        },
      });
      if (
        selected.status !== 'ready' ||
        !selected.provider.capabilities.toolCalling ||
        !current()
      )
        return;
      const intent = await generateConversationTemplateProposal({
        provider: selected.provider,
        execution: {
          operationRunId: operationRunId(),
          providerId: selected.provider.id,
          modelId: selected.modelId,
          recipient: selected.recipient,
          remoteProcessing: selected.remoteProcessing,
          consentScope: evidenceConsentScope({
            purpose: 'record_conversation',
            generatedArtifacts: false,
            external: false,
            publicWeb: false,
          }),
          allowedScope: { sourceKinds: [] },
          budget: {
            ...DEFAULT_MULTI_AGENT_BUDGET,
            maxModelCalls: 1,
          },
        },
        consent: input.consent,
        request: question,
        ...(admission.visitFollowup
          ? { priorTemplate: 'visit-questions' }
          : {}),
        signal: linked.controller.signal,
      });
      if (!intent || !current()) return;
      const verified = await owner.recheck(linked.controller.signal);
      if (current() && !verified) ownerChanged = true;
      if (current() && verified) return intent;
    };
    // Follow the owned request and selected transport. A fixed routing deadline
    // could commit ordinary chat before a valid template choice arrived.
    const intent = await Promise.race([propose(), retired]);
    return {
      intent: current() ? intent : undefined,
      spent,
      ...(ownerChanged || !owner.current() ? { ownerChanged: true } : {}),
    };
  } catch {
    return {
      spent,
      intent: undefined,
      ...(ownerChanged || !owner.current() ? { ownerChanged: true } : {}),
    };
  } finally {
    stopWaiting?.();
    unwatch?.();
    // End the proposal-only authorization/cancellation lifetime. This tool
    // is advice only; no result is ever sent back to the provider.
    linked.controller.abort();
    linked.dispose();
  }
}
