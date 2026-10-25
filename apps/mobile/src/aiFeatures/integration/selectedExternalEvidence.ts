import type {
  ExecutionConsentPort,
  EvidenceReference,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { requireSelectedAi } from './provider';
import { createExternalConversationEvidence } from './externalConversationEvidence';
import { createPublicWebEvidence } from './publicWebEvidence';

/** Offer each supported destination explicitly; neither adapter substitutes for the other. */
export function createSelectedExternalEvidence(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly consent: ExecutionConsentPort;
  readonly literature: EuropePmcMedicalEvidenceService;
  readonly literatureConsent: ExternalMedicalQueryConsentPort;
  readonly requireAbstract?: boolean;
}) {
  const literature = createExternalConversationEvidence(
    input.literature,
    input.literatureConsent,
    {
      requireAbstract: input.requireAbstract,
    },
  );
  const web = createPublicWebEvidence(input);
  return {
    tools: [literature.tool, ...(web ? [web.tool] : [])],
    usesPublicWeb: Boolean(web),
    validates: (reference: EvidenceReference) =>
      literature.validates(reference) || Boolean(web?.validates(reference)),
  };
}
