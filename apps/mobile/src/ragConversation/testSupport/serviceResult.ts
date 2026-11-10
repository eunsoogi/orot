import type {
  EvidenceReference,
  MultiAgentRunResult,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from '../task';

/** Model a validated workflow result without replacing the service's citation checks. */
export function result(
  reference: EvidenceReference,
  answer: string,
  literatureReferences?: readonly EvidenceReference[],
): MultiAgentRunResult<GroundedRagAnswer> {
  return {
    status: 'result',
    value: { answer, literatureReferences },
    citations: [reference],
    coverage: [],
    checkpoint: {} as never,
  };
}
