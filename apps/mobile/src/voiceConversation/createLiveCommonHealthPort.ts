import {
  nativeToolParameterSchema,
  type LiveToolCall,
} from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { EVIDENCE_WORKFLOW_BUDGET } from '../agent/evidenceWorkflowBudget';
import { evidenceConsentScope } from '../aiFeatures/integration/evidenceConsentScope';
import { bindHealthContextTool } from '../aiFeatures/integration/bindHealthContextTool';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { healthContextToolDefinition } from '../aiFeatures/integration/healthContextToolDefinition';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';
import { ragConversationTask } from '../ragConversation/task';
import { liveConversationToolsAuthorization } from '../voiceSettings/liveConversationToolsAuthorization';
import type { LiveResponsesSettings } from '../voiceSettings/liveResponsesSettings';
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
  const definition = healthContextToolDefinition('rag');
  return Object.freeze({
    ...witness,
    policy: 'common-tools-v3',
    providerId: 'openai-live-responses',
    recipient: 'OpenAI Responses (Live)',
    manifestRevision: 'canonical-health-context-v3',
    tools: Object.freeze([
      Object.freeze({
        name: definition.id,
        description: definition.description,
        parameters: nativeToolParameterSchema(definition.inputSchema),
      }),
    ]),
  });
}

/** V3 first value path: the ordinary bound health tool and its existing
 * transfer projection. Neither a duration/old V2 receipt nor an utterance
 * delta confers authority to add another source, provider, tool or mutation. */
export function createLiveCommonHealthPort(input: {
  readonly native: Native;
  readonly registration: LiveCommonRegistration;
  readonly settings: Active;
  readonly current: () => boolean;
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
  const owns = (call: LiveToolCall) =>
    current() && call === observed && native.challenge(call);
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
    protectedDataAvailable: input.protectedDataAvailable,
    subscribe(callId, accept) {
      const detach = native.subscribe(
        callId,
        registration,
        batch => {
          const call = batch.calls[0];
          if (!call || !current() || (observed && owns(observed))) return;
          observed = call;
          retained = undefined;
          const connect = async () => {
            if (
              !owns(call) ||
              !(await input.protectedDataAvailable()) ||
              !owns(call)
            )
              return;
            const data = await input.openData();
            if (!owns(call)) return;
            const registry = new LocalEvidenceReferenceRegistry();
            const tool = bindHealthContextTool(data, registry, 'rag');
            if (!tool || !owns(call)) return;
            accept({
              owner: batch.owner,
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
                execution: execution(call),
                initialEvidence: { items: [], coverage: [], conflicts: [] },
                provider,
                task: ragConversationTask,
                // This tool is context-free; no finalized transcript is inferred.
                request: '',
                consent,
                revalidateEvidence: (references, signal) =>
                  registry.revalidateEvidence(references, signal),
                tools: [
                  {
                    ...tool,
                    async search(request, runtime) {
                      if (
                        !owns(call) ||
                        !(await input.protectedDataAvailable()) ||
                        !owns(call)
                      )
                        throw new Error('Live source is no longer current');
                      const result = await tool.search(request, runtime);
                      if (!('status' in result) && owns(call))
                        retained = { call, data, batch: result, registry };
                      return result;
                    },
                  },
                ],
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
