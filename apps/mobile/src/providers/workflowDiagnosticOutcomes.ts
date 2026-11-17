/** Keep workflow detail tokens closed without expanding the shared stage catalog. */
export type WorkflowDiagnosticOutcome =
  | import('./reportTargetDiagnostic').ReportTargetDiagnostic
  | import('@orot/agent-runtime').CoverageDiagnosticCode
  | import('./workflowBudgetDiagnostic').BudgetDiagnosticOutcome
  | import('./workflowClarificationDiagnostic').ClarificationDiagnosticOutcome;
