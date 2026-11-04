import type { TaskResponderInput } from '@orot/agent-runtime';
import { containsDefinitiveClinicalClaim } from '../diseaseHypotheses/clinicalClaimGuard';

/** Recognize a narrow source-report sentence without treating lexical overlap as factual proof. */
export function hasUnsupportedClinicalClaim(
  answer: string,
  input: TaskResponderInput,
): boolean {
  if (!containsDefinitiveClinicalClaim(answer)) return false;
  return answer.split(/(?<=[.!?\n])/u).some(sentence => {
    if (!containsDefinitiveClinicalClaim(sentence)) return false;
    // Citation validation still owns source identity; this grammar is not semantic fact checking.
    const sourceReport =
      /^\s*(?:지난\s+)?(?:진료\s+)?기록(?:에는|에)\s+[^,.!?\n]+(?:라고|다고)\s+(?:적혀\s*있어요|기재되어\s*있어요|나와\s*있어요)[.!?]?\s*$/u;
    return (
      !input.evidence.items.some(
        item => item.sourceKind === 'personal_record',
      ) || !sourceReport.test(sentence)
    );
  });
}
