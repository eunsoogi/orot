import { observeModelStage } from '../src/multiAgent/modelStageDiagnostics';
import { callModel } from '../src/multiAgent/modelCall';
import { createEuropePmcEvidenceSearchTool } from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

test('stage diagnostics expose neither returned data nor thrown errors', async () => {
  const observer = jest.fn();
  const value = { private: 'synthetic medical content' };
  await expect(observeModelStage(observer, 'evidence_check', async () => value)).resolves.toBe(
    value,
  );
  const error = new Error('synthetic credential');
  await expect(
    observeModelStage(observer, 'consent_wait', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(observer.mock.calls).toEqual([
    ['evidence_check', 'started'],
    ['evidence_check', 'completed'],
    ['consent_wait', 'started'],
    ['consent_wait', 'completed'],
  ]);
});

test('a throwing diagnostic observer never changes the original outcome', async () => {
  const observer = () => {
    throw new Error('observer failed');
  };
  await expect(observeModelStage(observer, 'provider_wait', async () => 'result')).resolves.toBe(
    'result',
  );
  const error = new Error('original failure');
  await expect(
    observeModelStage(observer, 'provider_wait', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});

test.each([true, false])(
  'provider timing starts only after authorization (%s)',
  async (authorized) => {
    const observer = jest.fn();
    const { provider, generate } = makeProvider(['synthetic private response']);
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search: async () => ({ status: 'available', publications: [] }) },
      consent: { authorize: async () => 'authorized' },
    });
    const { execution } = workflowOptions(provider, tool);
    const result = await callModel(
      provider,
      { messages: [{ role: 'user', content: 'synthetic private input' }] },
      execution,
      { authorize: async () => (authorized ? 'authorized' : 'denied') },
      new AbortController().signal,
      undefined,
      undefined,
      observer,
    );
    expect(result.status).toBe(authorized ? 'response' : 'consent_required');
    expect(generate).toHaveBeenCalledTimes(authorized ? 1 : 0);
    expect(observer.mock.calls).toEqual(
      authorized
        ? [
            ['provider_wait', 'started'],
            ['provider_wait', 'completed'],
          ]
        : [],
    );
  },
);

test('rejected asynchronous diagnostics cannot produce an unhandled rejection', async () => {
  const observer = async () => {
    throw new Error('diagnostic failure');
  };
  await expect(observeModelStage(observer, 'consent_wait', async () => 'denied')).resolves.toBe(
    'denied',
  );
  await Promise.resolve();
});
