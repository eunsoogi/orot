import {
  startHistoryValidationCost,
  type HistoryValidationCost,
} from '../providers/conversationHistoryDiagnostic';

/** One synchronous observer per read. Admission includes work before callback entry;
 * settlement includes commit and publication. Neither span claims pure queue time.
 * No promise, result, SQL or authority is retained, including when disabled. */
export function createConversationReadDiagnostics(enabled: boolean) {
  let current: ReturnType<typeof startHistoryValidationCost> | undefined;
  const finish = (outcome: 'completed' | 'failed' = 'completed') => {
    const active = current;
    current = undefined;
    active?.(outcome);
  };
  return {
    start(stage: HistoryValidationCost) {
      if (enabled) current = startHistoryValidationCost(stage);
    },
    finish,
  };
}
