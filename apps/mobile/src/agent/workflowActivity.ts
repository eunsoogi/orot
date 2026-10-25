import type {
  MultiAgentInvocation,
  MultiAgentProgressEvent,
  MultiAgentResponderStreamEvent,
} from '@orot/agent-runtime';
import { t } from '../i18n';

export type AiWorkflowObserver = Pick<
  MultiAgentInvocation,
  'onProgress' | 'onTaskStreamEvent'
>;

/** Converts typed runtime phases to safe copy without showing search terms or evidence text. */
export function workflowProgressLabel(event: MultiAgentProgressEvent): string {
  if (event.type === 'model_started') {
    if (event.phase === 'evidence_research')
      return t('aiActivity.phase.research');
    if (event.phase === 'revised_response')
      return t('aiActivity.phase.revised');
    return t('aiActivity.phase.response');
  }
  if (event.status === 'completed') return t('aiActivity.evidence.completed');
  if (event.status === 'failed') return t('aiActivity.evidence.failed');
  if (event.status === 'cancelled') return t('aiActivity.evidence.cancelled');
  return t('aiActivity.evidence.started');
}

/** Applies replacement-aware task text while keeping structured model output private. */
export function applyWorkflowStreamEvent(
  current: string,
  event: MultiAgentResponderStreamEvent,
): string {
  if (event.type === 'started') return '';
  return event.type === 'text_delta' ? current + event.text : event.text;
}
