import type { TaskResponderInput } from '@orot/agent-runtime';
import { containsDefinitiveClinicalClaim } from '../diseaseHypotheses/clinicalClaimGuard';

// These patterns cover recognizable prohibited advice, not all possible model wording.
const numericDiseaseProbability =
  /(?:질병|질환|당뇨|고혈압|암|[가-힣]{1,10}(?:병|증|염)).{0,20}(?:확률|가능성|위험도).{0,12}\d+(?:\.\d+)?\s*(?:%|퍼센트)/u;
const medicationChangeInstruction =
  /(?:약|약물|용량|복용|투약|처방).{0,20}(?:중단|시작|변경|조절|증량|감량|늘리|줄이|바꾸|끊)(?:하세요|하십시오|으세요|세요|으십시오|해야 합니다|해야 해요|해야 한다|해야 돼요|하셔야|셔야|으셔야)/u;

/** Recognize a narrow source-report sentence without treating lexical overlap as factual proof. */
export function hasUnsupportedClinicalClaim(
  answer: string,
  input: TaskResponderInput,
): boolean {
  if (
    numericDiseaseProbability.test(answer) ||
    medicationChangeInstruction.test(answer)
  )
    return true;
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
