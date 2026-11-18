import { render } from '@testing-library/react-native';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { useInferenceConsent } from '../src/agent/execution/useInferenceConsent';
import {
  SettingsConsentReadServicesContext,
  type SettingsConsentReadServices,
} from '../src/agent/execution/SettingsConsentReadServices';
import { settingsPermissionsForFeature } from '../src/agent/execution/settingsConsentCatalog';
import { consentFixtureDestinations } from '../e2e/settingsConsentPersistenceFixture';
import { classificationConsentFixture } from './classificationConsentFixture';

let port: ExecutionConsentPort;
function Harness() {
  port = useInferenceConsent().consent;
  return null;
}
function tree(services: SettingsConsentReadServices) {
  return (
    <SettingsConsentReadServicesContext.Provider value={services}>
      <Harness />
    </SettingsConsentReadServicesContext.Provider>
  );
}
function request(): OutboundProcessingRequest {
  const permission = settingsPermissionsForFeature('calendar')[0]!;
  return {
    ...consentFixtureDestinations.calendar,
    operationRunId: 'synthetic-lifetime',
    remoteProcessing: true,
    consentScope: {
      purpose: permission.purpose,
      policyVersion: permission.policyVersion,
      dataCategories: permission.dataCategories,
    },
    allowedScope: { sourceKinds: ['personal_record'] },
    payload: { messages: [{ role: 'user', content: 'Synthetic only' }] },
    signal: new AbortController().signal,
  };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

test.each(['resolveOwner', 'readGrant'] as const)(
  'context replacement invalidates pending %s and issued witnesses, including A to B to A',
  async method => {
    const f = classificationConsentFixture();
    await f.input.fixture.approve('calendar');
    const pause = gate();
    const entered = gate();
    let pending = false;
    const services: SettingsConsentReadServices = {
      ...f.reads,
      resolveOwner: async r => {
        if (pending && method === 'resolveOwner') {
          entered.release();
          await pause.promise;
        }
        return f.reads.resolveOwner(r);
      },
      readGrant: async (...args) => {
        if (pending && method === 'readGrant') {
          entered.release();
          await pause.promise;
        }
        return f.reads.readGrant(...args);
      },
    };
    const view = await render(tree(services));
    try {
      const old = port;
      const issued = request();
      expect(await old.authorize(issued)).toBe('authorized');
      const listener = jest.fn();
      const stop = old.subscribeAuthorizationInvalidation!(issued, listener);
      pending = true;
      const inFlight = old.authorize(request());
      await entered.promise;
      await view.rerender(tree({ ...f.reads }));
      expect(listener).toHaveBeenCalled();
      expect(old.isAuthorizationCurrent!(issued)).toBe(false);
      await view.rerender(tree(services));
      pending = false;
      pause.release();
      expect(await inFlight).toBe('renewal_required');
      expect(await old.authorize(request())).toBe('renewal_required');
      expect(await port.authorize(request())).toBe('authorized');
      stop();
    } finally {
      pause.release();
      await view.unmount();
      f.db.close();
    }
  },
);

test.each(['revoke', 'unmount'] as const)(
  '%s during grant read cannot admit pending or issued requests',
  async action => {
    const f = classificationConsentFixture();
    await f.input.fixture.approve('calendar');
    const pause = gate();
    const entered = gate();
    let pending = false;
    const services: SettingsConsentReadServices = {
      ...f.reads,
      readGrant: async (...args) => {
        const grant = await f.reads.readGrant(...args);
        if (pending) {
          entered.release();
          await pause.promise;
        }
        return grant;
      },
    };
    const view = await render(tree(services));
    try {
      const old = port;
      const issued = request();
      expect(await old.authorize(issued)).toBe('authorized');
      const listener = jest.fn();
      const stop = old.subscribeAuthorizationInvalidation!(issued, listener);
      pending = true;
      const inFlight = old.authorize(request());
      await entered.promise;
      if (action === 'revoke') await f.input.fixture.revoke(true);
      else await view.unmount();
      expect(listener).toHaveBeenCalled();
      expect(old.isAuthorizationCurrent!(issued)).toBe(false);
      pause.release();
      expect(await inFlight).toBe('renewal_required');
      stop();
    } finally {
      pause.release();
      await view.unmount();
      f.db.close();
    }
  },
);

test('missing owner/grant and wrong recipient remain closed under scoped services', async () => {
  const f = classificationConsentFixture();
  await f.input.fixture.approve('calendar');
  const view = await render(
    tree({ ...f.reads, resolveOwner: async () => null }),
  );
  try {
    expect(await port.authorize(request())).toBe('renewal_required');
    await view.rerender(tree({ ...f.reads, readGrant: async () => null }));
    expect(await port.authorize(request())).toBe('renewal_required');
    await view.rerender(tree(f.reads));
    expect(
      await port.authorize({ ...request(), recipient: 'Foreign recipient' }),
    ).toBe('renewal_required');
  } finally {
    await view.unmount();
    f.db.close();
  }
});

test.each([null, undefined])(
  'invalid scoped services %s cannot fall back to production',
  async invalid => {
    await expect(
      render(tree(invalid as unknown as SettingsConsentReadServices)),
    ).rejects.toThrow('Complete settings consent read services required');
  },
);
