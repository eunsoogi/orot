import type { TaskResponderInput } from '@orot/agent-runtime';
import { t } from '../../i18n';

/** Synthetic report bodies and evidence identities shared by contract and workflow tests. */
export const answer = {
  observations: 'Synthetic reported observation.',
  explanations: 'Synthetic tentative explanation, not a diagnosis.',
  evidence: 'Synthetic support; contrary evidence is unknown.',
  unknowns: 'Synthetic missing information.',
  nextSteps: 'Synthetic question for a clinician.',
};
export const record = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record',
  sourceRevision: '1',
  evidenceId: 'record-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
  content: 'Synthetic reported observation.',
};
export const input = {
  request: t('conversationActions.possibilities'),
  context: { intent: 'conversation' },
  evidence: { items: [record], coverage: [], conflicts: [] },
} as unknown as TaskResponderInput;
