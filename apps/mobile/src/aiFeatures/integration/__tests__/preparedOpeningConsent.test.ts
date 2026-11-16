import type {
  OutboundProcessingRequest,
  ConsentDecision,
} from '@orot/agent-runtime';
import { createPreparedOpeningConsent } from '../preparedOpeningConsent';

function setup() {
  const controller = new AbortController();
  const request = { signal: controller.signal } as OutboundProcessingRequest;
  const authorize = jest.fn(async (): Promise<ConsentDecision> => 'authorized');
  return {
    controller,
    request,
    authorize,
    gate: createPreparedOpeningConsent({ authorize }),
  };
}

test('successful preparation forwards the exact request once without pre-approval', async () => {
  const f = setup();
  const pending = f.gate.port.authorize(f.request);
  await Promise.resolve();
  expect(f.authorize).not.toHaveBeenCalled();
  f.gate.release(true);
  expect(await pending).toBe('authorized');
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(f.authorize).toHaveBeenCalledWith(f.request);
});

test.each(['failed', 'cancelled'] as const)(
  'a %s preflight never opens consent even after a later ready callback',
  async kind => {
    const f = setup();
    const pending = f.gate.port.authorize(f.request);
    if (kind === 'cancelled') f.controller.abort();
    f.gate.release(kind !== 'failed');
    f.gate.release(true);
    expect(await pending).toBe('renewal_required');
    expect(f.authorize).not.toHaveBeenCalled();
  },
);

test('another gate cannot release or cancel this request and denial remains denial', async () => {
  const f = setup();
  const other = setup();
  f.authorize.mockResolvedValue('renewal_required');
  const pending = f.gate.port.authorize(f.request);
  other.gate.release(true);
  await Promise.resolve();
  expect(f.authorize).not.toHaveBeenCalled();
  f.gate.release(true);
  expect(await pending).toBe('renewal_required');
  expect(other.authorize).not.toHaveBeenCalled();
});
