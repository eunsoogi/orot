import { conversationPublicSearchPlan } from '../conversationPublicSearchPlan';
import type { ConversationWorkflowContinuation } from '../../../ragConversation/conversationWorkflowContinuation';

function input() {
  const search = jest.fn(async () => ({
    items: [],
    coverage: [],
    conflicts: [],
  }));
  const prepareAuthorizedSearch = jest.fn();
  return {
    search,
    prepareAuthorizedSearch,
    value: {
      external: {
        publicWebTool: {
          id: 'public-web-search',
          search,
          prepareAuthorizedSearch,
        },
      },
      runId: 'synthetic-run',
      question: '수면에 관한 합성 질문',
      signal: new AbortController().signal,
    } as unknown as Parameters<typeof conversationPublicSearchPlan>[0],
  };
}

test('retained search preparation transmits nothing and uses only app-owned topics', async () => {
  const f = input();
  const plan = await conversationPublicSearchPlan({
    ...f.value,
    continuation: {} as ConversationWorkflowContinuation,
  });
  expect(f.search).not.toHaveBeenCalled();
  expect(f.prepareAuthorizedSearch).not.toHaveBeenCalled();
  expect(plan.initialSearch).toEqual({
    toolId: 'public-web-search',
    input: { topics: ['sleep'] },
  });
  expect(plan.chargeEagerSearch).toBe(false);
  expect(plan.coldSearch).toBeUndefined();
  expect(plan.operationRunId).toBe('synthetic-run');
  plan.onInitialSearchStatus('pending');
  expect(plan.currentSearch.status).toBe('unavailable');
  plan.onInitialSearchStatus('consent_required');
  expect(plan.currentSearch.status).toBe('consent_required');
});

test('nonretained calls preserve the existing one-shot eager lookup', async () => {
  const f = input();
  const plan = await conversationPublicSearchPlan(f.value);
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(plan.initialSearch).toBeUndefined();
  expect(plan.currentSearch.status).toBe('empty');
  expect(plan.chargeEagerSearch).toBe(true);
  expect(plan.includeExternalTools).toBe(false);
  expect(plan.coldSearch).toEqual({
    version: 1,
    status: 'empty',
    charged: true,
  });
});
