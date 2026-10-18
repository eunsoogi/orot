import type { MultiAgentProgressEvent } from '@orot/agent-runtime';
import { getRagConversationCopy } from './copy';

/** Maps provider progress to content-free conversation activity. */
export function progressCopy(
  event: MultiAgentProgressEvent,
  copy: ReturnType<typeof getRagConversationCopy>,
): string {
  if (event.type === 'model_started') {
    if (event.phase === 'evidence_research') return copy.progressResearch;
    if (event.phase === 'revised_response') return copy.progressRevisedAnswer;
    return copy.progressAnswer;
  }
  if (event.status === 'completed') return copy.progressEvidenceComplete;
  if (event.status === 'failed') return copy.progressEvidenceFailed;
  if (event.status === 'cancelled') return copy.progressEvidenceCancelled;
  return event.sourceKind === 'external_medical'
    ? copy.progressExternalSearch
    : copy.progressLocalSearch;
}
