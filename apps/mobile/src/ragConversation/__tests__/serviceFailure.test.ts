import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerDiagnostic,
  reportWorkflowOutcome,
} from '../../providers/diagnostics';
import { runRagConversationTurn } from '../service';
import type { RagConversationRunOptions } from '../service';

jest.mock('@orot/agent-runtime', () => ({ runMultiAgentWorkflow: jest.fn() }));
jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
  reportWorkflowOutcome: jest.fn(),
}));

function options(
  loadCurrentEvidence: RagConversationRunOptions['loadCurrentEvidence'],
): RagConversationRunOptions {
  return {
    question: '어떤 기록을 확인할 수 있나요?',
    previousMessages: [],
    loadCurrentEvidence,
    rag: { search: jest.fn(async () => []) },
    workflow: {} as never,
  };
}

test('classifies retrieval errors without exposing their details', async () => {
  jest.mocked(runMultiAgentWorkflow).mockReset();
  const outcome = await runRagConversationTurn(
    options(async () => {
      throw new Error('Private storage detail.');
    }),
  );

  expect(outcome).toEqual({ status: 'failure', kind: 'retrieval_failed' });
  expect(JSON.stringify(outcome)).not.toContain('Private storage detail');
  expect(providerDiagnostic).toHaveBeenCalledWith('rag', 'data', 'failed');
  expect(runMultiAgentWorkflow).not.toHaveBeenCalled();
});

test('classifies an aborted retrieval as cancelled', async () => {
  jest.mocked(runMultiAgentWorkflow).mockReset();
  const abort = new Error('Private cancellation detail.');
  abort.name = 'AbortError';
  const outcome = await runRagConversationTurn(
    options(async () => {
      throw abort;
    }),
  );

  expect(outcome).toEqual({ status: 'failure', kind: 'cancelled' });
  expect(JSON.stringify(outcome)).not.toContain('Private cancellation detail');
  expect(runMultiAgentWorkflow).not.toHaveBeenCalled();
});

test('reports workflow status and the safe provider code after a failed model run', async () => {
  jest
    .mocked(runMultiAgentWorkflow)
    .mockReset()
    .mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'Private provider detail.',
      providerErrorCode: 'authentication_required',
      checkpoint: {},
    } as never);
  const outcome = await runRagConversationTurn(
    options(async () => ({
      batch: { items: [], coverage: [], conflicts: [] },
      chunks: [],
    })),
  );

  expect(outcome).toEqual({
    status: 'failure',
    kind: 'provider_authentication',
  });
  expect(reportWorkflowOutcome).toHaveBeenCalledWith(
    'rag',
    'unavailable',
    'authentication_required',
    'Private provider detail.',
  );
  expect(JSON.stringify(outcome)).not.toContain('Private provider detail');
});
