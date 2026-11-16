import { liveModelSteering } from '../src/multiAgent/liveModelSteering';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import type { WorkflowSteeringStore } from '../src';
import type { LanguageModelExecutionOptions } from '@orot/model-runtime';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

const request = { messages: [{ role: 'user' as const, content: 'Synthetic question' }] };
function fixture(authorized = true) {
  const { provider, generate } = makeProvider([]);
  let listener: (() => Promise<void>) | undefined;
  const rows = [{ id: 'live', text: 'Shorter please', sequence: 1, status: 'queued' as const }];
  const store: WorkflowSteeringStore = {
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    enqueue: async () => true,
    list: async () => rows,
    bind: async (_id, value) => value,
    acknowledge: async () => true,
    beginLive: jest.fn(async () => {
      await listener?.();
      return true;
    }),
    settleLive: jest.fn(async () => true),
  };
  const consent = {
    authorize: jest.fn(async () =>
      authorized ? ('authorized' as const) : ('renewal_required' as const),
    ),
  };
  const context = {
    options: {
      ...workflowOptions(provider, {} as never),
      provider: { ...provider, capabilities: { ...provider.capabilities, midTurnSteering: true } },
      consent,
      operationJournal: { steering: store },
    },
    signal: new AbortController().signal,
    midTurnSteeringBudget: { available: true, used: false },
  } as unknown as RuntimeContext<unknown>;
  let options: LanguageModelExecutionOptions | undefined;
  generate.mockImplementation(async (_request, execution) => {
    options = execution;
    return { ok: false, error: { code: 'internal_error', message: '', retryable: false } };
  });
  return { context, consent, store, options: () => options, wake: async () => listener?.() };
}

test('submits during the active invocation without awaiting completion and persists before transport', async () => {
  const f = fixture();
  const submit = jest.fn(async () => {});
  const live = liveModelSteering(f.context, 'model:1', request, f.consent);
  await live.provider.generate(request);
  f.options()!.midTurnSteering!.onReady({ submit });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(submit).toHaveBeenCalledWith('live', 'Shorter please');
  expect(f.store.beginLive).toHaveBeenCalledWith('model:1', 'live');
  expect(f.context.midTurnSteeringBudget!.used).toBe(true);
  await f.wake();
  expect(submit).toHaveBeenCalledTimes(1);
  await f.options()!.midTurnSteering!.onEvent({ id: 'live', status: 'accepted' });
  expect(f.store.settleLive).toHaveBeenLastCalledWith('model:1', 'live', 'accepted');
  await f.options()!.midTurnSteering!.onEvent({ id: 'live', status: 'applied' });
  expect(f.store.settleLive).toHaveBeenLastCalledWith('model:1', 'live', 'applied');
  expect(f.consent.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: { messages: [...request.messages, { role: 'user', content: 'Shorter please' }] },
    }),
  );
  await live.close();
});

test('refused exact payload consent sends nothing and leaves the original invocation untouched', async () => {
  const f = fixture(false);
  const submit = jest.fn(async () => {});
  const live = liveModelSteering(f.context, 'model:1', request, f.consent);
  await live.provider.generate(request);
  f.options()!.midTurnSteering!.onReady({ submit });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(submit).not.toHaveBeenCalled();
  expect(f.store.beginLive).not.toHaveBeenCalled();
  expect(f.context.signal.aborted).toBe(false);
  await live.close();
});

test('no spare budget or no capability leaves transport unchanged', () => {
  const f = fixture();
  f.context.midTurnSteeringBudget!.available = false;
  expect(liveModelSteering(f.context, 'model:1', request, f.consent).provider).toBe(
    f.context.options.provider,
  );
});

test('closing during authorization prevents a late submission', async () => {
  const f = fixture();
  const submit = jest.fn(async () => {});
  let allow!: () => void;
  const prepare = () =>
    new Promise<'ready'>((resolve) => {
      allow = () => resolve('ready');
    });
  const live = liveModelSteering(f.context, 'model:1', request, f.consent, prepare);
  await live.provider.generate(request);
  f.options()!.midTurnSteering!.onReady({ submit });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const closing = live.close();
  allow();
  await closing;
  expect(submit).not.toHaveBeenCalled();
  expect(f.store.beginLive).not.toHaveBeenCalled();
});

test('closing bounds an unresolved bridge submission without replay or false failure', async () => {
  const f = fixture();
  const submit = jest.fn(() => new Promise<void>(() => {}));
  const live = liveModelSteering(f.context, 'model:1', request, f.consent);
  await live.provider.generate(request);
  f.options()!.midTurnSteering!.onReady({ submit });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(submit).toHaveBeenCalledTimes(1);
  await live.close();
  expect(f.context.midTurnSteeringBudget!.used).toBe(true);
  expect(f.store.settleLive).not.toHaveBeenCalled();
  expect(f.context.signal.aborted).toBe(false);
});
