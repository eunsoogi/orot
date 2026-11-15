import type { LanguageModelRequest } from '@orot/model-runtime';
import { authorizeModelCall } from '../src/multiAgent/modelAuthorization';
import { callModel } from '../src/multiAgent/modelCall';
import { createEuropePmcEvidenceSearchTool } from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

function fixture() {
  const { provider, generate } = makeProvider(['synthetic result']);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const { execution } = workflowOptions(provider, tool);
  const request: LanguageModelRequest = { messages: [{ role: 'user', content: 'Synthetic' }] };
  const controller = new AbortController();
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  return { execution, request, controller, consent, provider, generate };
}

test('an exact grant is single use and cannot be serialized into a reusable approval', async () => {
  const f = fixture();
  const grant = await authorizeModelCall(f.request, f.execution, f.consent, f.controller.signal);
  if (grant.status !== 'authorized') throw new Error('Expected grant');
  expect(JSON.stringify(grant)).toBe('{"status":"authorized"}');
  expect(grant.consume(f.request, f.execution, f.controller.signal)).toBe(true);
  expect(grant.consume(f.request, f.execution, f.controller.signal)).toBe(false);
});

test('changed account invalidates the grant permanently', async () => {
  const f = fixture();
  const grant = await authorizeModelCall(f.request, f.execution, f.consent, f.controller.signal);
  if (grant.status !== 'authorized') throw new Error('Expected grant');
  expect(
    grant.consume(f.request, { ...f.execution, recipient: 'other-account' }, f.controller.signal),
  ).toBe(false);
  expect(grant.consume(f.request, f.execution, f.controller.signal)).toBe(false);
});

test('late old approval dispatches nothing; a fresh approval dispatches exactly once', async () => {
  const f = fixture();
  let approve!: (value: 'authorized') => void;
  f.consent.authorize.mockImplementation(
    () =>
      new Promise((resolve) => {
        approve = resolve;
      }),
  );
  const pending = callModel(f.provider, f.request, f.execution, f.consent, f.controller.signal);
  f.controller.abort();
  expect(await pending).toEqual({ status: 'cancelled', providerStop: 'not_started' });
  approve('authorized');
  await Promise.resolve();
  expect(f.generate).not.toHaveBeenCalled();
  f.consent.authorize.mockResolvedValue('authorized');
  expect(
    (await callModel(f.provider, f.request, f.execution, f.consent, new AbortController().signal))
      .status,
  ).toBe('response');
  expect(f.consent.authorize).toHaveBeenCalledTimes(2);
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('a continuation with another signal cannot consume an old grant', async () => {
  const f = fixture();
  const grant = await authorizeModelCall(f.request, f.execution, f.consent, f.controller.signal);
  if (grant.status !== 'authorized') throw new Error('Expected grant');
  expect(grant.consume(f.request, f.execution, new AbortController().signal)).toBe(false);
});
