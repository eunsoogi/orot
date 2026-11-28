import {
  authorizeModelCall,
  DEFAULT_MULTI_AGENT_BUDGET,
  guardProviderAuthorization,
  type ExecutionConsentPort,
  type MultiAgentExecutionIdentity,
} from '@orot/agent-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from '../../providers/selection/options';
import { createLinkedAbortController } from './linkedAbortController';
import { operationRunId } from './featureRunIdentity';
import type { requireSelectedAi } from './provider';

const tool = 'classify-memory-request';
const choices = ['section', 'whole-summary', 'ordinary'] as const;
type Choice = (typeof choices)[number];

/** This tool only classifies the current authored instruction. It does not
 * receive or look up the earlier summary, stored identifiers, or health data. */
export async function classifyHealthSummaryMemory(input: {
  question: string;
  selected: ReturnType<typeof requireSelectedAi>;
  current: () => boolean;
  confirm: () => Promise<boolean>;
  signal: AbortSignal;
  consent: ExecutionConsentPort;
}): Promise<Choice | undefined> {
  const { question, selected, current, confirm, signal, consent } = input;
  if (
    selected.remoteProcessing ||
    selected.provider.id !== APPLE_PROVIDER_ID ||
    selected.modelId !== APPLE_FOUNDATION_MODEL_SELECTION_ID ||
    selected.option.privacyBoundary !== 'on-device' ||
    selected.onDeviceSelectionWitness?.isCurrent() !== true ||
    !question.trim() ||
    question.length > 1000 ||
    !current()
  )
    return;
  const linked = createLinkedAbortController(signal);
  const child = linked.controller.signal;
  const deadline = setTimeout(
    () => linked.controller.abort(),
    DEFAULT_MULTI_AGENT_BUDGET.timeoutMs,
  );
  const stillCurrent = () => !child.aborted && current();
  let detach: (() => void) | undefined;
  const retired = new Promise<undefined>(resolve => {
    const stop = () => resolve(undefined);
    child.addEventListener('abort', stop, { once: true });
    detach = () => child.removeEventListener('abort', stop);
    if (child.aborted) stop();
  });
  const classify = async () => {
    const request: LanguageModelRequest = {
      messages: [
        {
          role: 'system',
          content:
            'Classify the current author’s actual requested operation, in any language. A completed health summary is the immediately preceding card; its content is unavailable. Select section only if the author deliberately asks to keep a useful part, excerpt, key point, or subset from that report as local memory. Select whole-summary only when the author directly asks to retain the entire report or a bookmark/link to it. Select ordinary for a question, advice, extraction without a save request, negation, hypothetical, quoted command, a different target, a separate fact the author wrote, ambiguous or mixed intent, or instructions about the classifier itself. Never generate health advice or a fact; call the classifier tool once with one intent.',
        },
        { role: 'user', content: question },
      ],
      tools: [
        {
          name: tool,
          description:
            'Classify the actual requested operation; does not perform it.',
          inputSchema: {
            type: 'object',
            properties: { intent: { type: 'string', enum: choices } },
            required: ['intent'],
            additionalProperties: false,
          },
        },
      ],
      toolChoice: 'required',
      maxOutputTokens: 64,
    };
    const identity: MultiAgentExecutionIdentity = {
      operationRunId: operationRunId(),
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: false,
      consentScope: {
        purpose: 'record_conversation',
        dataCategories: ['conversation'],
        policyVersion: 'local-records-v1',
      },
      allowedScope: { sourceKinds: [] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    };
    if (
      selected.remoteProcessing ||
      !stillCurrent() ||
      !(await confirm()) ||
      !stillCurrent()
    )
      return;
    const grant = await authorizeModelCall(request, identity, consent, child);
    if (
      grant.status !== 'authorized' ||
      !stillCurrent() ||
      !grant.consume(request, identity, child)
    )
      return;
    const provider = guardProviderAuthorization(
      selected.provider,
      () => stillCurrent() && grant.isCurrent(),
      grant.subscribeInvalidation,
    ).provider;
    const result = await provider.generate(request, { signal: child });
    if (
      !stillCurrent() ||
      !result.ok ||
      result.value.finishReason !== 'tool_calls' ||
      result.value.toolCalls.length !== 1
    )
      return;
    const call = result.value.toolCalls[0];
    if (
      !call?.id.trim() ||
      call.name !== tool ||
      Object.keys(call.arguments).join(',') !== 'intent'
    )
      return;
    return choices.find(choice => choice === call.arguments.intent);
  };
  try {
    return await Promise.race([classify(), retired]);
  } catch {
    return undefined;
  } finally {
    detach?.();
    clearTimeout(deadline);
    linked.controller.abort();
    linked.dispose();
  }
}
