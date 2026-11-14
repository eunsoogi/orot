import {
  conversationBackgroundProvider,
  conversationConsentScope,
  createConversationBackgroundScope,
} from '../conversationBackgroundProvider';
import { executionNeedsDecision } from '../../../agent/execution/executionDecisionObserver';
import type { LanguageModelProvider } from '@orot/model-runtime';

const provider = () =>
  ({
    kind: 'language-model',
    id: 'synthetic',
    displayName: 'Synthetic',
    capabilities: {},
    generate: jest.fn(async () => ({ status: 'unavailable' })),
    stream: jest.fn(async function* () {
      yield { status: 'unavailable' };
    }),
  }) as unknown as LanguageModelProvider;

test('background work begins at dispatch, not provider selection or stream iterator construction', async () => {
  const working = jest.fn();
  const wrapped = conversationBackgroundProvider(provider(), true, working);
  expect(working).not.toHaveBeenCalled();
  await wrapped.generate({} as never);
  expect(working).toHaveBeenCalledTimes(1);
  const stream = wrapped.stream!({} as never);
  expect(working).toHaveBeenCalledTimes(1);
  for await (const result of stream) {
    expect(result).toEqual({ status: 'unavailable' });
  }
  expect(working).toHaveBeenCalledTimes(2);
});

test('local execution clears decision state without requesting CPU/network extension or GPU', async () => {
  const working = jest.fn();
  await conversationBackgroundProvider(provider(), false, working).generate(
    {} as never,
  );
  expect(working).toHaveBeenCalledWith(false);
});

test('only an actual scoped disclosure emits a decision boundary, and disposal removes it', () => {
  const onExecutionState = jest.fn();
  const scope = createConversationBackgroundScope(undefined, {
    onExecutionState,
  });
  expect(onExecutionState).not.toHaveBeenCalled();
  executionNeedsDecision(new AbortController().signal);
  expect(onExecutionState).not.toHaveBeenCalled();
  executionNeedsDecision(scope.controller.signal);
  expect(onExecutionState).toHaveBeenCalledWith('decision');
  scope.dispose();
  executionNeedsDecision(scope.controller.signal);
  expect(onExecutionState).toHaveBeenCalledTimes(1);
});

test('actual child authorization signal observes a disclosure but cached approval does not', async () => {
  const onExecutionState = jest.fn();
  const child = new AbortController();
  const cached = conversationConsentScope(
    { authorize: async (_request: { signal: AbortSignal }) => 'authorized' },
    { onExecutionState },
  );
  expect(await cached.authorize({ signal: child.signal })).toBe('authorized');
  expect(onExecutionState).not.toHaveBeenCalled();
  const prompt = conversationConsentScope(
    {
      authorize: async (request: { signal: AbortSignal }) => {
        executionNeedsDecision(request.signal);
        return 'renewal_required';
      },
    },
    { onExecutionState },
  );
  expect(await prompt.authorize({ signal: child.signal })).toBe(
    'renewal_required',
  );
  expect(onExecutionState).toHaveBeenCalledTimes(1);
  executionNeedsDecision(child.signal);
  expect(onExecutionState).toHaveBeenCalledTimes(1);
});

test('authorized public search dispatch participates in the same bounded background work', async () => {
  const working = jest.fn();
  const search = jest.fn(async () => ({
    ok: true as const,
    value: { text: '', callCount: 1, citations: [] },
  }));
  const wrapped = conversationBackgroundProvider(
    { ...provider(), searchPublicWeb: search },
    true,
    working,
  );
  expect(working).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await wrapped.searchPublicWeb!(
    { query: 'synthetic public topic' },
    { signal },
  );
  expect(working).toHaveBeenCalledWith(true);
  expect(search).toHaveBeenCalledWith(
    { query: 'synthetic public topic' },
    { signal },
  );
});
