import type { JsonValue } from '@orot/model-runtime';
import type { TaskResponderInput } from '@orot/agent-runtime';
import { publicSearchFailureGaps } from '../aiFeatures/integration/publicSearchFailure';
import { requestsLiteratureExplanation } from './literatureIntent';

/** Only optional web availability may be missing from a partial local-record
 * answer. Citation binding, clinical validation and freshness still run normally.
 * No external claim, local coverage gap, conflict or literature request qualifies. */
export function acceptsLocalPublicSearchFallback(
  value: JsonValue,
  input: TaskResponderInput,
): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('answerKind' in value) ||
    !('completion' in value) ||
    value.answerKind !== 'grounded' ||
    value.completion !== 'partial' ||
    requestsLiteratureExplanation(input.request) ||
    /(?:웹|인터넷|온라인).*(?:검색|찾|확인)|(?:search|look up|find).*\b(?:web|internet|online)\b|\b(?:web|internet|online)\b.*(?:search|look up|find)/iu.test(
      input.request,
    ) ||
    input.evidence.conflicts.length ||
    !input.evidence.items.length ||
    input.evidence.items.some(
      item => !['personal_record', 'reviewed_memory'].includes(item.sourceKind),
    )
  )
    return false;
  const local = input.evidence.coverage.filter(
    entry => entry.sourceKind !== 'external_medical',
  );
  const external = input.evidence.coverage.filter(
    entry => entry.sourceKind === 'external_medical',
  );
  return (
    local.length > 0 &&
    external.length > 0 &&
    input.evidence.items.every(item =>
      local.some(
        entry =>
          entry.sourceKind === item.sourceKind &&
          entry.searchedSourceIds.includes(item.sourceId),
      ),
    ) &&
    local.every(entry => !entry.gaps.length && !entry.truncated) &&
    external.every(
      entry =>
        entry.returnedCount === 0 &&
        entry.searchedSourceIds.length === 1 &&
        entry.searchedSourceIds[0] === 'public-web' &&
        entry.gaps.length === 1 &&
        Object.values(publicSearchFailureGaps).some(
          gap => gap === entry.gaps[0],
        ),
    )
  );
}
