import { SafetyPolicyEngine } from '@orot/domain';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { RecordRepository } from '@orot/storage';
import {
  collectHealthReviewEvidence,
  requireEncounterActive,
  runMultiAgentWorkflow,
  encounterCanonical,
} from '@orot/agent-runtime';
import type {
  EvidenceSearchTool,
  EvidenceReference,
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
  resolve(reference: EvidenceReference): EvidenceReference | undefined;
  restore?(references: readonly EvidenceReference[]): void;
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
  const aliases = new Map<string, EvidenceReference>();
  const validateCurrent: HealthReviewPort['revalidate'] = async (
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
    references(batch) {
      return batch.items.map(item => {
        const original = input.evidence.resolve(item);
        if (!original)
          throw new Error('Original health evidence identity unavailable.');
        // Resolve only explicit reference fields. Provider aliases and raw content cannot become durable identity.
        const reference: EvidenceReference = {
          sourceKind: original.sourceKind,
          sourceId: original.sourceId,
          sourceRevision: original.sourceRevision,
          evidenceId: original.evidenceId,
          evidenceRevision: original.evidenceRevision,
          locator: original.locator,
          effectiveTime: original.effectiveTime,
          reviewState: original.reviewState,
          ...(original.unit === undefined ? {} : { unit: original.unit }),
        };
        aliases.set(encounterCanonical(reference), item);
        return reference;
      });
    },
    async revalidate(references, signal) {
      const current = references.map(reference =>
        aliases.get(encounterCanonical(reference)),
      );
      return (
        current.every((reference): reference is EvidenceReference =>
          Boolean(reference),
        ) && validateCurrent(current as EvidenceReference[], signal)
      );
    },
    async collect(signal, references = []) {
      await live(signal);
      input.evidence.restore?.(references);
      return collectHealthReviewEvidence({
        execution: input.model.execution,
        store: input.model.store,
        signal,
        revalidate: validateCurrent,
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
          revalidateEvidence: validateCurrent,
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
