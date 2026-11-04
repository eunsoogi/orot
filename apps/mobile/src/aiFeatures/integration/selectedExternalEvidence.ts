import type {
  ExecutionConsentPort,
  EvidenceReference,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { requireSelectedAi } from './provider';
import { createExternalConversationEvidence } from './externalConversationEvidence';
import { createPublicWebEvidence } from './publicWebEvidence';
import type { AiFeatureLocalData } from './localData';
import { retainPublicWebResults } from './researchRetention';
import type { ResearchSessionLease } from '../../storage/researchArtifactStorage';
import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { isControlledPublicWebQuery } from '../../agent/execution/publicWebQuery';

/** Offer each supported destination explicitly; neither adapter substitutes for the other. */
export function createSelectedExternalEvidence(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly consent: ExecutionConsentPort;
  readonly literature: EuropePmcMedicalEvidenceService;
  readonly literatureConsent: ExternalMedicalQueryConsentPort;
  readonly requireAbstract?: boolean;
  readonly loadData?: () => Promise<AiFeatureLocalData>;
  readonly originFeature?: string;
  readonly retentionSession?: ResearchSessionLease;
  readonly captureResearchInputs?: (
    signal: AbortSignal,
  ) => Promise<readonly SavedSummarySource[]>;
  readonly validateResearchInputs?: (signal: AbortSignal) => Promise<boolean>;
  readonly onResearchRetained?: (
    ids: readonly number[],
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  const literature = createExternalConversationEvidence(
    input.literature,
    input.literatureConsent,
    {
      requireAbstract: input.requireAbstract,
    },
  );
  const web = createPublicWebEvidence({
    ...input,
    beforeDispatch: async (query, signal) =>
      isControlledPublicWebQuery(query) ||
      !input.validateResearchInputs ||
      input.validateResearchInputs(signal),
  });
  const publicWebTool =
    web && input.loadData
      ? retainPublicWebResults(
          web.tool,
          input.loadData,
          input.selected.provider.id,
          input.selected.modelId,
          input.originFeature ?? 'record_conversation',
          input.retentionSession,
          input.captureResearchInputs,
          input.onResearchRetained,
        )
      : web?.tool;
  return {
    tools: [literature.tool, ...(publicWebTool ? [publicWebTool] : [])],
    publicWebTool,
    usesPublicWeb: Boolean(web),
    validates: (reference: EvidenceReference) =>
      literature.validates(reference) || Boolean(web?.validates(reference)),
  };
}
