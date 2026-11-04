import type {
  EvidenceBatch,
  EvidenceSearchTool,
  MultiAgentBudget,
} from '@orot/agent-runtime';
import type { DiseaseHypothesisRunOutcome } from '../../diseaseHypotheses/types';

export type DefaultPublicSearchResult =
  | { readonly status: 'success'; readonly batch: EvidenceBatch }
  | {
      readonly status:
        'empty' | 'unavailable' | 'consent_required' | 'cancelled';
    };

/** Reserve the preflight provider call inside the feature's existing budget. */
export function budgetAfterPublicSearch(
  budget: MultiAgentBudget,
  search: DefaultPublicSearchResult,
  hasTool: boolean,
): MultiAgentBudget {
  const spent =
    search.status === 'success' ||
    search.status === 'empty' ||
    (search.status === 'unavailable' && hasTool);
  return { ...budget, maxModelCalls: budget.maxModelCalls - (spent ? 1 : 0) };
}

export function publicSearchNotice(
  status: 'empty' | 'unavailable' | 'consent_required' | 'cancelled',
): string {
  return status === 'empty'
    ? '공개 웹검색에서 결과를 찾지 못했어요.'
    : status === 'consent_required'
      ? '공개 웹검색 동의가 없어 검색 결과를 반영하지 못했어요.'
      : '공개 웹검색을 사용할 수 없어 검색 결과를 반영하지 못했어요.';
}

/** Preserve the local result while making a missing public lookup visible and durable. */
export function annotatePublicSearchLimit(
  outcome: DiseaseHypothesisRunOutcome,
  search: DefaultPublicSearchResult,
): DiseaseHypothesisRunOutcome {
  if (
    search.status === 'success' ||
    search.status === 'cancelled' ||
    outcome.status !== 'workflow' ||
    outcome.result.status !== 'result'
  )
    return outcome;
  const notice = publicSearchNotice(search.status);
  return {
    ...outcome,
    result: {
      ...outcome.result,
      value: {
        ...outcome.result.value,
        hypotheses: outcome.result.value.hypotheses.map(item => ({
          ...item,
          uncertainty: `${item.uncertainty} ${notice}`,
        })),
      },
    },
  };
}

// The local classifier selects only fixed public concepts. It never copies a
// substring of a question, record, transcript, or identifier into the query.
const topics = [
  ['blood_pressure', /혈압|blood pressure/iu],
  ['heart_rate', /심박|맥박|heart rate|pulse/iu],
  ['sleep', /수면|잠|sleep/iu],
  ['physical_activity', /운동|활동|exercise|activity/iu],
  ['medication_effects', /약|복용|medication|medicine/iu],
  ['pain', /통증|아픔|pain/iu],
  ['fatigue', /피로|fatigue/iu],
  ['dizziness', /어지|dizz/iu],
  ['headache', /두통|headache/iu],
] as const;

/** Executes one isolated, consent-checked public lookup before feature generation. */
export async function runDefaultPublicSearch(input: {
  readonly tool: EvidenceSearchTool | undefined;
  readonly operationRunId: string;
  readonly request: string;
  readonly signal: AbortSignal;
}): Promise<DefaultPublicSearchResult> {
  if (input.signal.aborted) return { status: 'cancelled' };
  if (!input.tool) return { status: 'unavailable' };
  const matched = topics.filter(([, pattern]) => pattern.test(input.request));
  const selected = matched.slice(0, 4).map(([topic]) => topic);
  try {
    const result = await input.tool.search({
      operationRunId: input.operationRunId,
      operationKey: 'default-public-search',
      input: { topics: selected.length ? selected : ['general_health'] },
      allowedScope: { sourceKinds: ['external_medical'] },
      resultLimit: 1,
      maxPayloadBytes: 65536,
      signal: input.signal,
    });
    if (input.signal.aborted) return { status: 'cancelled' };
    if ('status' in result) return { status: 'consent_required' };
    return result.items.length
      ? { status: 'success', batch: result }
      : { status: 'empty' };
  } catch {
    // Provider errors do not establish an empty result or an offline state.
    return { status: input.signal.aborted ? 'cancelled' : 'unavailable' };
  }
}
