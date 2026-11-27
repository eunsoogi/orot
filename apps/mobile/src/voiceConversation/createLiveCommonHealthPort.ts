import { startLiveCommonHealthTiming } from './liveCommonHealthTiming';
import type { LiveToolCall } from '@orot/agent-runtime';
import { prepareOwnedConversationReadSelection } from '../conversationTools/ownedConversationReadSelection';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { EVIDENCE_WORKFLOW_BUDGET } from '../agent/evidenceWorkflowBudget';
import { evidenceConsentScope } from '../aiFeatures/integration/evidenceConsentScope';
import { bindOwnedLiveConversationInvocation } from './ownedLiveConversationInvocation';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';
import { ragConversationTask } from '../ragConversation/task';
import { liveConversationToolsAuthorization } from '../voiceSettings/liveConversationToolsAuthorization';
import type { LiveResponsesSettings } from '../voiceSettings/liveResponsesSettings';
import { matchesOwnedLiveConversationDeclarations } from './ownedLiveConversationDeclarations';
import { liveStockHealthCatalog } from './liveStockHealthDescriptor';
import type { LiveCommonConversationPort } from './liveCommonConversationRun';
import {
  type LiveCommonRegistration,
  type LiveCommonWitness,
  type nativeLiveCommonConversation,
} from './nativeLiveCommonConversation';
import {
  prepareLiveCommonHealthSettlement,
  type CommonHealthSource,
} from './prepareLiveCommonHealthSettlement';

type Native = NonNullable<ReturnType<typeof nativeLiveCommonConversation>>;
type Active = Extract<LiveResponsesSettings, { kind: 'active' }>;

export function canonicalLiveCommonRegistration(
  witness: LiveCommonWitness,
): LiveCommonRegistration {
  return Object.freeze({
    ...witness,
    policy: 'common-tools-v3',
    providerId: 'openai-live-responses',
    recipient: 'OpenAI Responses (Live)',
    manifestRevision: 'canonical-health-context-v3',
    tools: liveStockHealthCatalog.manifest.tools,
  });
}

/** Use the stock Chat invocation behind the current native manifest. Its V3
 * projection remains the exact health-result scope; lookup availability does
 * not widen model consent, native output authority, or supported action scope. */
export function createLiveCommonHealthPort(input: {
  readonly native: Native;
  readonly registration: LiveCommonRegistration;
  readonly settings: Active;
  readonly current: () => boolean;
  readonly toolOwnerCurrent: () => boolean;
  readonly protectedDataAvailable: () => Promise<boolean>;
  readonly openData: () => Promise<AiFeatureLocalData>;
}): LiveCommonConversationPort {
  const { native, registration, settings } = input;
  const current = () =>
    input.current() &&
    settings.current() &&
    settings.commonToolsPolicy === 'common-tools-v3';
  const consent = liveConversationToolsAuthorization(settings, current);
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: registration.providerId,
    displayName: 'Live Responses',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate() {
      throw new Error('Live tool graph does not generate model output.');
    },
  };
  let observed: LiveToolCall | undefined;
  let retained: CommonHealthSource | undefined;
  const retired = new Set<string>();
  const clear = () => {
    if (observed) retired.add(observed.challengeId);
    observed = undefined;
    retained = undefined;
  };
  const owns = (call: LiveToolCall) =>
    current() &&
    input.toolOwnerCurrent() &&
    call === observed &&
    native.challenge(call);
  const execution = (call: LiveToolCall) => ({
    operationRunId: call.responseId,
    providerId: registration.providerId,
    modelId: registration.backendModel,
    recipient: registration.recipient,
    remoteProcessing: true,
    consentScope: evidenceConsentScope({
      purpose: 'record_conversation',
      generatedArtifacts: false,
      external: false,
      publicWeb: false,
    }),
    allowedScope: { sourceKinds: ['personal_record'] as const },
    budget: EVIDENCE_WORKFLOW_BUDGET,
  });
  return {
    commonToolsPolicy: 'common-tools-v3',
    current,
    cancelCurrent: clear,
    protectedDataAvailable: input.protectedDataAvailable,
    subscribe(callId, accept) {
      const detach = native.subscribe(
        callId,
        registration,
        liveStockHealthCatalog.acceptsArguments,
        batch => {
          const call = batch.calls[0];
          if (
            !call ||
            !current() ||
            !input.toolOwnerCurrent() ||
            retired.has(call.challengeId) ||
            (observed && owns(observed))
          )
            return;
          observed = call;
          retained = undefined;
          const connect = async () => {
            if (
              !owns(call) ||
              !(await input.protectedDataAvailable()) ||
              !owns(call)
            )
              return;
            const dataOpen = startLiveCommonHealthTiming('data_open');
            const data = await input.openData();
            if (!owns(call)) return;
            dataOpen();
            const registry = new LocalEvidenceReferenceRegistry();
            const scope = execution(call);
            const declaration = registration.tools.find(
              candidate => candidate.name === call.name,
            );
            const selection =
              declaration &&
              prepareOwnedConversationReadSelection({
                declaration,
                operationRunId: scope.operationRunId,
                allowedScope: scope.allowedScope,
                admittedArguments: call.args,
                current: () => owns(call),
                protectedDataAvailable: input.protectedDataAvailable,
              });
            if (!selection) return;
            let evidenceRead: (() => void) | undefined;
            const tools = bindOwnedLiveConversationInvocation({
              data,
              registry,
              current: () => owns(call),
              ...selection,
              beforeRead(...args) {
                evidenceRead = startLiveCommonHealthTiming('evidence_lookup');
                return selection.beforeRead(...args);
              },
              startStockRead: () => startLiveCommonHealthTiming('stock_read'),
              didRead(id, result) {
                if (id === call.name && owns(call)) {
                  retained = { call, data, batch: result, registry };
                  evidenceRead?.();
                  evidenceRead = undefined;
                }
              },
            });
            if (
              !tools ||
              !matchesOwnedLiveConversationDeclarations(
                tools,
                registration.tools,
              ) ||
              !owns(call)
            )
              return;
            accept({
              owner: batch.owner,
              queuedCurrent: () => owns(call),
              utterance: { kind: 'context-free', current: () => owns(call) },
              nativeChallengeCurrent: candidate =>
                stable(candidate) === stable(call) && owns(call),
              async select(declarations) {
                return owns(call) &&
                  stable(declarations) === stable(registration.tools)
                  ? batch
                  : undefined;
              },
              workflow: {
                execution: scope,
                initialEvidence: { items: [], coverage: [], conflicts: [] },
                provider,
                task: ragConversationTask,
                // This tool is context-free; no finalized transcript is inferred.
                request: '',
                consent,
                revalidateEvidence: (references, signal) =>
                  registry.revalidateEvidence(references, signal),
                tools,
              },
            });
          };
          connect().catch(() => undefined);
        },
        id => {
          if (observed?.challengeId === id) {
            observed = undefined;
            retained = undefined;
          }
        },
      );
      return () => {
        observed = undefined;
        retained = undefined;
        detach();
      };
    },
    prepareSettlement(result, signal) {
      return prepareLiveCommonHealthSettlement({
        source: retained,
        result,
        signal,
        native,
        owns,
        protectedDataAvailable: input.protectedDataAvailable,
        execution,
        consent,
      });
    },
  };
}
