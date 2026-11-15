import type { MultiAgentCheckpointState } from './contracts';

export function validResumeShape(saved: MultiAgentCheckpointState): boolean {
  // Durable phase and evidence-need values must match a state the graph knows how to route.
  return (
    [
      'task_response',
      'evidence_research',
      'evidence_search',
      'local_action',
      'revised_response',
      'complete',
    ].includes(saved.phase) &&
    (saved.evidenceNeed === undefined ||
      ['missing_coverage', 'verify_conflict', 'confirm_value', 'other'].includes(
        saved.evidenceNeed,
      ))
  );
}
