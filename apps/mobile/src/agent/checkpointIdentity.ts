export function createWorkflowCheckpointConfig(
  workflowId: string,
  appThreadId: string,
  checkpointNamespace = '',
) {
  if (!workflowId.trim() || !appThreadId.trim()) {
    throw new Error(
      'Workflow checkpoint identity requires a workflow and app thread id.',
    );
  }
  return {
    configurable: {
      thread_id: [workflowId, appThreadId].map(encodeURIComponent).join(':'),
      checkpoint_ns: checkpointNamespace,
    },
  };
}
