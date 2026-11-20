import type { ExecutionConsentPort, OutboundProcessingRequest } from '../src';
import { createEuropePmcEvidenceSearchTool } from '../src';
import { authorizeModelCall } from '../src/multiAgent/modelAuthorization';
import { callModel, dispatchAuthorizedModelCall } from '../src/multiAgent/modelCall';
import { callModelWithEvidenceFreshness } from '../src/multiAgent/modelCallFreshness';
import { guardProviderAuthorization } from '../src/multiAgent/authorizedProvider';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import { makeProvider, workflowOptions, reference } from './multiAgent-external-evidence-fixtures';

function fixture() {
  const { provider, generate } = makeProvider(['Synthetic']);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(provider, tool);
  const request = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
  const signal = new AbortController().signal;
  let live = true;
  let approved: OutboundProcessingRequest | undefined;
  const consent: ExecutionConsentPort = {
    authorize: async (outbound) => {
      approved = outbound;
      return 'authorized';
    },
    isAuthorizationCurrent: (outbound) => live && outbound === approved,
  };
  return {
    options,
    request,
    signal,
    provider,
    generate,
    consent,
    revoke: () => {
      live = false;
    },
  };
}

test.each(['revocation', 'account replacement', 'model replacement'])(
  '%s after approval prevents native dispatch',
  async () => {
    const f = fixture();
    const grant = await authorizeModelCall(f.request, f.options.execution, f.consent, f.signal);
    if (grant.status !== 'authorized') throw new Error('Expected initial approval');
    f.revoke();
    expect(
      await dispatchAuthorizedModelCall(
        f.provider,
        f.request,
        f.options.execution,
        grant,
        f.signal,
      ),
    ).toEqual({ status: 'consent_required' });
    expect(f.generate).not.toHaveBeenCalled();
  },
);

test('freshness wrapper retains live fence across asynchronous source validation', async () => {
  const f = fixture();
  const context = {
    options: {
      ...f.options,
      consent: f.consent,
      revalidateEvidence: async () => {
        f.revoke();
        return true;
      },
    },
    signal: f.signal,
    timedOut: () => false,
    currentEvidence: {
      ...f.options.initialEvidence,
      items: [{ ...reference, content: 'Synthetic' }],
    },
  } as RuntimeContext<unknown>;
  expect((await callModelWithEvidenceFreshness(context, f.request))?.status).toBe(
    'consent_required',
  );
  expect(f.generate).not.toHaveBeenCalled();
});

test('revocation after consume but before adapter dispatch is rejected', async () => {
  const f = fixture();
  expect(
    await callModel(
      f.provider,
      f.request,
      f.options.execution,
      f.consent,
      f.signal,
      undefined,
      undefined,
      (stage, event) => {
        if (stage === 'provider_wait' && event === 'started') f.revoke();
      },
    ),
  ).toEqual({ status: 'consent_required' });
  expect(f.generate).not.toHaveBeenCalled();
});

test('lazy stream creation does not consume a second send and checks on first next', async () => {
  const f = fixture();
  const stream = jest.fn(async function* () {
    yield { ok: true as const, value: { type: 'text_delta' as const, text: 'Synthetic' } };
  });
  const grant = await authorizeModelCall(f.request, f.options.execution, f.consent, f.signal);
  if (grant.status !== 'authorized') throw new Error('Expected initial approval');
  expect(grant.consume(f.request, f.options.execution, f.signal)).toBe(true);
  const guarded = guardProviderAuthorization({ ...f.provider, stream }, () => grant.isCurrent());
  const iterator = guarded.provider.stream!(f.request)[Symbol.asyncIterator]();
  f.revoke();
  await expect(iterator.next()).rejects.toThrow();
  expect(stream).not.toHaveBeenCalled();
  expect(guarded.wasDenied()).toBe(true);
});

test('legacy ports still generate once and preserve the provider method receiver', async () => {
  const f = fixture();
  const provider = {
    ...f.provider,
    generate: jest.fn(function (this: typeof f.provider, request, options) {
      expect(this).toBe(provider);
      return f.provider.generate(request, options);
    }),
  };
  expect(
    (
      await callModel(
        provider,
        f.request,
        f.options.execution,
        { authorize: async () => 'authorized' },
        f.signal,
      )
    ).status,
  ).toBe('response');
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'photo authorization stays live until dispatch (remote=%s)',
  async (remoteProcessing) => {
    const f = fixture();
    let photoApproved = false;
    let photoCurrent = true;
    const photoConsent: ExecutionConsentPort = {
      authorize: async () => {
        photoApproved = true;
        return 'authorized';
      },
      isAuthorizationCurrent: () => photoCurrent,
    };
    const context = {
      options: {
        ...f.options,
        execution: { ...f.options.execution, remoteProcessing },
        consent: f.consent,
        photoInput: { evidenceIds: ['synthetic-photo'], consent: photoConsent },
        revalidateEvidence: async () => {
          if (photoApproved) photoCurrent = false;
          return true;
        },
      },
      signal: f.signal,
      timedOut: () => false,
      currentEvidence: {
        ...f.options.initialEvidence,
        items: [{ ...reference, content: 'Synthetic' }],
      },
    } as RuntimeContext<unknown>;
    expect((await callModelWithEvidenceFreshness(context, f.request))?.status).toBe(
      'consent_required',
    );
    expect(photoApproved).toBe(true);
    expect(f.generate).not.toHaveBeenCalled();
  },
);

test('a throwing live fence is denial rather than a provider failure', async () => {
  const f = fixture();
  f.consent.isAuthorizationCurrent = () => {
    throw new Error('Synthetic');
  };
  expect(
    (await callModel(f.provider, f.request, f.options.execution, f.consent, f.signal)).status,
  ).toBe('consent_required');
  expect(f.generate).not.toHaveBeenCalled();
});
