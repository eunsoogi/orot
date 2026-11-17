/** Keep workflow detail tokens closed without expanding the shared stage catalog. */
export type WorkflowDiagnosticOutcome =
  | import('../ragConversation/conversationToolCaptureFailure').ToolCaptureFailureDiagnostic
  | import('../ragConversation/conversationResultDiagnostic').ConversationResultDiagnostic
  | import('./reportTargetDiagnostic').ReportTargetDiagnostic
  | import('@orot/agent-runtime').CoverageDiagnosticCode
  | import('./workflowBudgetDiagnostic').BudgetDiagnosticOutcome
  | import('./workflowClarificationDiagnostic').ClarificationDiagnosticOutcome;
