import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { retainedVisitConsent } from '../retainedVisitConsent';

const request = () =>
  ({ signal: new AbortController().signal }) as OutboundProcessingRequest;
test('retained visit approval and subscriptions stay on the exact original request and port', async () => {
  const stop = jest.fn();
  const first: ExecutionConsentPort = {
    authorize: jest.fn(async () => 'authorized'),
    isAuthorizationCurrent: jest.fn(() => true),
    subscribeAuthorizationInvalidation: jest.fn(() => stop),
  };
  let selected = first;
  const consent = retainedVisitConsent(() => selected);
  const exact = request();
  expect(await consent.authorize(exact)).toBe('authorized');
  const listener = jest.fn();
  expect(consent.subscribeAuthorizationInvalidation!(exact, listener)).toBe(
    stop,
  );
  expect(first.subscribeAuthorizationInvalidation).toHaveBeenCalledWith(
    exact,
    listener,
  );
  expect(consent.isAuthorizationCurrent!({ ...exact })).toBe(false);
  selected = {
    authorize: async () => 'authorized',
    isAuthorizationCurrent: () => true,
  };
  expect(consent.isAuthorizationCurrent!(exact)).toBe(false);
  expect(listener).not.toHaveBeenCalled();
});

test('a route port replacement while authorization is pending cannot approve the old request', async () => {
  let finish!: () => void;
  let selected: ExecutionConsentPort | undefined = {
    authorize: async () => {
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return 'authorized';
    },
  };
  const consent = retainedVisitConsent(() => selected);
  const exact = request();
  const pending = consent.authorize(exact);
  selected = { authorize: async () => 'authorized' };
  finish();
  expect(await pending).toBe('renewal_required');
  expect(consent.isAuthorizationCurrent!(exact)).toBe(false);
  selected = undefined;
  expect(await consent.authorize(request())).toBe('renewal_required');
});

test.each([false, null, undefined, 'throw'] as const)(
  'a present malformed or denied fence fails closed: %s',
  async value => {
    const owner: ExecutionConsentPort = {
      authorize: async () => 'authorized',
      isAuthorizationCurrent: (() => {
        if (value === 'throw') throw new Error('synthetic fence failure');
        return value;
      }) as ExecutionConsentPort['isAuthorizationCurrent'],
    };
    const consent = retainedVisitConsent(() => owner);
    const exact = request();
    expect(await consent.authorize(exact)).toBe('renewal_required');
    expect(consent.isAuthorizationCurrent!(exact)).toBe(false);
    const invalidated = jest.fn();
    consent.subscribeAuthorizationInvalidation!(exact, invalidated);
    expect(invalidated).toHaveBeenCalledTimes(1);
  },
);
