import type {
  ExecutionConsentPort,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import type { EuropePmcMedicalEvidenceService } from '../externalMedicalEvidence/europePmc';
import type { requireSelectedAi } from '../aiFeatures/integration/provider';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import type { ConversationToolContext } from './conversationToolContext';
import type { createResearchInputTracker } from '../aiFeatures/integration/researchInputTracker';
import {
  createSelectedExternalEvidence,
  type SelectedExternalEvidenceSnapshot,
} from '../aiFeatures/integration/selectedExternalEvidence';
import { retainLiteratureResults } from '../aiFeatures/integration/researchRetention';
/** Share the conversation's consent and retention boundaries with literature tools. */
export function conversationExternalEvidence(input: {
  selected: ReturnType<typeof requireSelectedAi>;
  consent: ExecutionConsentPort;
  queryConsent: ExternalMedicalQueryConsentPort;
  externalEvidence: EuropePmcMedicalEvidenceService;
  loadLocalData: () => Promise<AiFeatureLocalData>;
  observer?: ConversationToolContext;
  researchInputs: ReturnType<typeof createResearchInputTracker>;
  restored?: SelectedExternalEvidenceSnapshot;
  owner?: () => Promise<boolean>;
}) {
  const {
    selected,
    consent,
    queryConsent,
    externalEvidence,
    loadLocalData,
    observer,
    researchInputs,
    owner: recoveredOwnerIsCurrent,
  } = input;
  // An omitted history can leave no references, but never releases the recovered
  // owner's fence at optional network dispatches.
  const checkOwner = async (signal?: AbortSignal) => {
    if (
      signal?.aborted ||
      !(await recoveredOwnerIsCurrent?.()) ||
      signal?.aborted
    )
      throw new Error('Conversation research owner is no longer current.');
  };
  const provider = selected.provider;
  const external = createSelectedExternalEvidence({
    selected:
      recoveredOwnerIsCurrent && provider.searchPublicWeb
        ? {
            ...selected,
            provider: {
              ...provider,
              async searchPublicWeb(request, options) {
                await checkOwner(options?.signal);
                return provider.searchPublicWeb!(request, options);
              },
            },
          }
        : selected,
    consent,
    recoverUnavailable: true,
    restored: input.restored,
    literature: retainLiteratureResults(
      recoveredOwnerIsCurrent
        ? {
            ...externalEvidence,
            async search(query, options) {
              await checkOwner(options.signal);
              return externalEvidence.search(query, options);
            },
          }
        : externalEvidence,
      loadLocalData,
      'record_conversation',
      observer?.retentionSession,
      researchInputs.recordResearch,
      { providerId: selected.provider.id, modelId: selected.modelId },
    ),
    literatureConsent: queryConsent,
    loadData: loadLocalData,
    originFeature: 'record_conversation',
    retentionSession: observer?.retentionSession,
    captureResearchInputs: researchInputs.capture,
    validateResearchInputs: researchInputs.revalidate,
    onResearchRetained: researchInputs.recordResearch,
  });
  // The separate generated-report feature still uses its private preflight port.
  // Conversation transports receive only the uniform declared capabilities.
  return {
    tools: observer?.protectedLocalInput ? [] : external.tools,
    snapshot: external.snapshot,
    validates: external.validates,
    usesPublicWeb: external.usesPublicWeb,
  };
}
