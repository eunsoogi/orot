import {
  DEFAULT_MULTI_AGENT_BUDGET,
  generateConversationTemplateProposal,
} from '@orot/agent-runtime';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { requestsArtifactContinuation } from '../../ragConversation/artifactContinuation';
import { isRagConversationAvailabilityQuestion } from '../../ragConversation/availabilityIntent';
import { validateInitialConversationResponse } from '../../ragConversation/initialResponse';
import { conversationReceiptSelection } from './conversationReceiptSelection';
import { evidenceConsentScope } from './evidenceConsentScope';
import { operationRunId } from './featureRunIdentity';
import { createLinkedAbortController } from './linkedAbortController';
import type { SelectedAiResolution } from './provider';

/**
 * Replace the optional opening only for a live ChatGPT composer turn.
 * Apple currently has no matching strict proposal-ownership witness.
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
  const owner = observer?.expectedConversationModel;
  if (
    !admission ||
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    !observer.retentionRequestId ||
    !owner?.providerId.startsWith('chatgpt-plan:') ||
    !owner.isCurrent ||
    !owner.isDurablyCurrent ||
    !observer.onTaskStreamEvent ||
    signal.aborted ||
    !admission.current() ||
    !validateInitialConversationResponse('살펴볼게요.', question) ||
    isRagConversationAvailabilityQuestion(question) ||
    (observer.artifactContinuation && requestsArtifactContinuation(question))
  )
    return;
  const linked = createLinkedAbortController(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spent = false;
  let ownerChanged = false;
  try {
    const current = () =>
      !linked.controller.signal.aborted &&
      admission.current() &&
      owner.isCurrent!();
    // A slow selector/grant cannot indefinitely postpone the normal answer.
    const timeout = new Promise<undefined>(resolve => {
      timer = setTimeout(() => {
        linked.controller.abort();
        resolve(undefined);
      }, 2500);
    });
    const propose = async () => {
      if (!current()) return;
      const selected = conversationReceiptSelection(await input.select(), {
        expectedConversationModel: {
          ...owner,
          isCurrent: current,
          isDurablyCurrent: async () =>
            current() && (await owner.isDurablyCurrent!()) && current(),
        },
        // Routing is not a receipt for the ordinary or specialized answer.
        onExecutionState: () => {
          spent = true;
        },
      });
      if (
        selected.status !== 'ready' ||
        !selected.remoteProcessing ||
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
            timeoutMs: 2500,
          },
        },
        consent: input.consent,
        request: question,
        signal: linked.controller.signal,
      });
      if (!intent || !current()) return;
      const verified = await owner.isDurablyCurrent!();
      if (current() && !verified) ownerChanged = true;
      if (current() && verified) return intent;
    };
    const intent = await Promise.race([propose(), timeout]);
    return {
      intent: current() ? intent : undefined,
      spent,
      ...(ownerChanged ? { ownerChanged } : {}),
    };
  } catch {
    return {
      spent,
      intent: undefined,
      ...(ownerChanged ? { ownerChanged } : {}),
    };
  } finally {
    if (timer) clearTimeout(timer);
    // End the proposal-only authorization/cancellation lifetime. This tool
    // is advice only; no result is ever sent back to the provider.
    linked.controller.abort();
    linked.dispose();
  }
}
