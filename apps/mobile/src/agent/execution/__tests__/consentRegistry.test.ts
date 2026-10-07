import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createExecutionConsentRegistry } from '../consentRegistry';

function request(
  overrides: Partial<OutboundProcessingRequest> = {},
): OutboundProcessingRequest {
  return {
    operationRunId: 'run-117-1',
    providerId: 'selected-provider',
    modelId: 'selected-model',
    recipient: 'selected-account',
    remoteProcessing: true,
    allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
    payload: {
      messages: [{ role: 'user', content: 'Synthetic record value 120/80.' }],
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('in-memory execution consent registry', () => {
  it('reuses only the exact approved provider, model, recipient, scope, and payload snapshot', async () => {
    const confirm = jest.fn(async () => true);
    const registry = createExecutionConsentRegistry(confirm);
    const first = request();

    await expect(registry.authorize(first)).resolves.toBe('authorized');
    await expect(registry.authorize(request())).resolves.toBe('authorized');
    await expect(
      registry.authorize(request({ modelId: 'different-model' })),
    ).resolves.toBe('authorized');

    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('requires renewed approval after evidence expands and stores nothing when declined', async () => {
    const confirm = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const registry = createExecutionConsentRegistry(confirm);
    const original = request();
    await expect(registry.authorize(original)).resolves.toBe('authorized');

    const expanded = request({
      payload: {
        messages: [
          { role: 'user', content: 'Synthetic record value 120/80.' },
          {
            role: 'user',
            content: 'New evidence revision: synthetic excerpt.',
          },
        ],
      },
    });
    await expect(registry.authorize(expanded)).resolves.toBe(
      'renewal_required',
    );
    await expect(registry.authorize(expanded)).resolves.toBe(
      'renewal_required',
    );
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it('does not prompt for local processing and does not record approval after cancellation', async () => {
    const confirm = jest.fn(async () => true);
    const registry = createExecutionConsentRegistry(confirm);
    await expect(
      registry.authorize(request({ remoteProcessing: false })),
    ).resolves.toBe('authorized');
    const controller = new AbortController();
    controller.abort();
    await expect(
      registry.authorize(request({ signal: controller.signal })),
    ).resolves.toBe('renewal_required');
    expect(confirm).not.toHaveBeenCalled();
  });
});
