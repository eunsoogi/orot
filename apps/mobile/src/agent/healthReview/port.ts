import { SafetyPolicyEngine } from '@orot/domain';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { RecordRepository } from '@orot/storage';
import {
  collectHealthReviewEvidence,
  requireEncounterActive,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import type {
  EvidenceSearchTool,
  HealthReviewPort,
  HealthReviewText,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { healthReviewTask } from './task';

export type HealthReviewModel = Pick<
  MultiAgentWorkflowOptions<HealthReviewText>,
  'provider' | 'execution' | 'consent' | 'store'
>;
export interface HealthReviewEvidence {
  trends: EvidenceSearchTool;
  records: EvidenceSearchTool;
  revalidate: HealthReviewPort['revalidate'];
}

/** App adapter owns the actual deterministic engine; no caller can substitute a permissive safety decision. */
export function createHealthReviewPort(input: {
  sourceId: string;
  repository: RecordRepository;
  model: HealthReviewModel;
  evidence: HealthReviewEvidence;
}): HealthReviewPort {
  const live = async (signal: AbortSignal) => {
    requireEncounterActive(signal);
    await input.repository.transaction(async (_writer, sql) => {
      if (!sql) throw new Error('Canonical health review storage required.');
      await requireLiveCheckpointSource(sql, input.sourceId);
    });
    requireEncounterActive(signal);
  };
  const revalidate: HealthReviewPort['revalidate'] = async (
    references,
    signal,
  ) => {
    await live(signal);
    const result =
      !references.length ||
      (await input.evidence.revalidate(references, signal));
    requireEncounterActive(signal);
    return result;
  };
  return {
    async assessSafety(value, signal) {
      await live(signal);
      return new SafetyPolicyEngine().evaluate(value);
    },
    revalidate,
    async collect(signal) {
      await live(signal);
      return collectHealthReviewEvidence({
        execution: input.model.execution,
        store: input.model.store,
        signal,
        revalidate,
        trends: {
          tool: input.evidence.trends,
          input: {
            days: 30,
            topics: ['measurements', 'symptoms'],
            detail: 'weekly',
          },
        },
        records: {
          tool: input.evidence.records,
          input: { query: '최근 건강 기록 변화', view: 'health_overview' },
        },
      });
    },
    async explain(batch, signal) {
      await live(signal);
      const result = await runMultiAgentWorkflow(
        {
          ...input.model,
          request: '최근 건강 변화와 아직 확인할 항목 및 질문을 정리해 주세요.',
          task: healthReviewTask,
          initialEvidence: batch,
          tools: [],
          revalidateEvidence: revalidate,
        },
        { signal },
      );
      if (result.status !== 'result')
        throw new Error('Health review did not produce a validated result.');
      await live(signal);
      return result.value;
    },
  };
}
