import type { Outcome } from './diagnosticTypes';

/** Exact runtime reasons map to fixed tokens; arbitrary exception text never crosses native. */
export function workflowUnavailableDiagnostic(reason?: string): Outcome {
  switch (reason) {
    case 'The allowlisted evidence search failed.':
      return 'workflow_search_failed';
    case 'The allowlisted evidence search did not produce valid current evidence.':
      return 'workflow_search_unavailable';
    case 'The workflow could not complete safely.':
      return 'workflow_exception';
    case 'The action outcome is unknown; do not repeat it.':
      return 'workflow_action_unknown';
    default:
      return 'workflow_unavailable_other';
  }
}
