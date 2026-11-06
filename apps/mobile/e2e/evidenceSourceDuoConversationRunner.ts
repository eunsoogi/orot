import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';

/** An opt-in synthetic answer uses the real local tool and registered source alias, without model dispatch. */
export const runEvidenceSourceDuoConversation: NonNullable<
  AiFeatureServiceDependencies['ragRunner']
> = async (options, invocation) => {
  const tool = options.workflow.tools.find(
    value => value.id === 'local-personal-records',
  );
  if (!tool) throw new Error('The local evidence search tool is unavailable.');
  const result = await tool.search({
    operationRunId: options.workflow.execution.operationRunId,
    operationKey: 'evidence-source-duo-conversation-probe',
    input: { query: '저장된 원문 근거 확인' },
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 1,
    maxPayloadBytes: 16 * 1024,
    signal: invocation?.signal ?? new AbortController().signal,
  });
  if ('status' in result || result.items.length !== 1 || !result.items[0])
    throw new Error('The synthetic evidence citation was not found.');
  const citation = referenceOnly(result.items[0]);
  options.onValidatedEvidence?.([citation]);
  return {
    status: 'answer',
    answer: '화면 동작 확인을 위한 합성 원문입니다.',
    citations: [citation],
  };
};

/** Both synthetic runners preserve the registry alias without exposing its backing record. */
export function referenceOnly(item: EvidenceItem): EvidenceReference {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
    locator: item.locator,
    effectiveTime: item.effectiveTime,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    reviewState: item.reviewState,
  };
}
