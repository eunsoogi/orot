import { runMultiAgentWorkflow } from '../src';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

test.each([false, true])(
  'a failed input fence stops the actual tool before dispatch, native=%s',
  async (native) => {
    const f = standardSearchFixture(native);
    const result = await runMultiAgentWorkflow(f.options, {
      config: f.config,
      beforeTaskInputChange: async () => {
        throw new Error('private synthetic content');
      },
    });
    expect(f.searchDomain).not.toHaveBeenCalled();
    expect(result.status).toBe('stale_evidence');
    expect(JSON.stringify(result)).not.toContain('private synthetic content');
  },
);

test('cancellation while fencing does not start the tool', async () => {
  const f = standardSearchFixture(false);
  const controller = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = runMultiAgentWorkflow(f.options, {
    config: f.config,
    signal: controller.signal,
    beforeTaskInputChange: () => {
      entered();
      return new Promise<void>(() => {});
    },
  });
  await ready;
  controller.abort();
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(f.searchDomain).not.toHaveBeenCalled();
});
