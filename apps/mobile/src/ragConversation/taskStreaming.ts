import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { hasUnsupportedClinicalClaim } from './clinicalClaimValidation';
import { requestsLiteratureExplanation } from './literatureIntent';

/** Keep external and generated evidence private until source and result validation. */
export function projectConversationStream(
  rawOutput: string,
  input: TaskResponderInput,
): string | undefined {
  if (requestsLiteratureExplanation(input.request)) return undefined;
  if (
    input.evidence.items.some(
      item =>
        item.sourceKind === 'generated_artifact' ||
        item.sourceKind === 'external_medical',
    )
  )
    return undefined;
  if (
    !input.evidence.items.some(
      item => item.sourceKind !== 'external_medical',
    ) &&
    extractPartialJsonStringAtPath(rawOutput, ['value', 'answerKind']) !==
      'conversation'
  )
    return undefined;
  const answer = extractPartialJsonStringAtPath(rawOutput, ['value', 'answer']);
  return answer && !hasUnsupportedClinicalClaim(answer, input)
    ? answer
    : undefined;
}
