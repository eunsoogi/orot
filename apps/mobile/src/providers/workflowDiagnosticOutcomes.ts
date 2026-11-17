/** Keep workflow detail tokens closed without expanding the shared stage catalog. */
export type WorkflowDiagnosticOutcome =
  | import('./workflowBudgetDiagnostic').BudgetDiagnosticOutcome
  | import('./workflowClarificationDiagnostic').ClarificationDiagnosticOutcome;
