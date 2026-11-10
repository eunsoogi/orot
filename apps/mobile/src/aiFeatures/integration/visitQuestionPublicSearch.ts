import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { EvidenceCaveat } from '../../nextVisitQuestions/types';
import type { SelectedAiResolution } from './provider';
import { operationRunId } from './featureRunIdentity';
import { createPublicWebEvidence } from './publicWebEvidence';
import { runDefaultPublicSearch } from './defaultPublicSearch';

/** Search only controlled public topics; visit questions retain their local-only citation contract. */
export async function visitQuestionPublicSearch(input: {
  selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  confirm: (request: OutboundProcessingRequest) => Promise<boolean>;
  query: string;
  signal: AbortSignal;
}) {
  const web = createPublicWebEvidence({
    selected: input.selected,
    consent: {
      authorize: async request => {
        try {
          return (await input.confirm(request))
            ? 'authorized'
            : 'renewal_required';
        } catch {
          // A failed consent prompt never authorizes outbound processing.
          return 'renewal_required';
        }
      },
    },
  });
  const result = await runDefaultPublicSearch({
    tool: web?.tool,
    operationRunId: operationRunId(),
    request: input.query,
    signal: input.signal,
  });
  const caveat: EvidenceCaveat | undefined =
    result.status === 'cancelled'
      ? undefined
      : result.status === 'success'
        ? 'public_search_not_retained'
        : result.status === 'consent_required'
          ? 'public_search_consent_required'
          : result.status === 'empty'
            ? 'public_search_empty'
            : result.status === 'unavailable' && result.reason === 'offline'
              ? 'public_search_offline'
              : web
                ? 'public_search_failed'
                : input.selected.provider.searchPublicWeb
                  ? 'public_search_not_configured'
                  : 'public_search_unsupported';
  return {
    result,
    caveat,
    spentModelCall:
      Boolean(web) &&
      (result.status === 'success' ||
        result.status === 'empty' ||
        result.status === 'unavailable'),
  };
}
