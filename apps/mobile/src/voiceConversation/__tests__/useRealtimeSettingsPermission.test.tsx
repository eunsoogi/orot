import { act, renderHook } from '@testing-library/react-native';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { useRealtimeSettingsPermission } from '../useRealtimeSettingsPermission';

const mockConsent: ExecutionConsentPort = {
  authorize: jest.fn(async () => 'authorized' as const),
  isAuthorizationCurrent: jest.fn(() => true),
  subscribeAuthorizationInvalidation: jest.fn(() => () => {}),
};
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({ consent: mockConsent, disclosureSheet: null }),
}));
beforeEach(() => {
  jest
    .mocked(mockConsent.authorize)
    .mockReset()
    .mockResolvedValue('authorized');
  jest
    .mocked(mockConsent.isAuthorizationCurrent!)
    .mockReset()
    .mockReturnValue(true);
  jest
    .mocked(mockConsent.subscribeAuthorizationInvalidation!)
    .mockReset()
    .mockReturnValue(() => {});
});

it('keeps the exact audio request current and aborts its call on revocation', async () => {
  let invalidate = () => {};
  const removed = jest.fn();
  jest
    .mocked(mockConsent.subscribeAuthorizationInvalidation!)
    .mockImplementation((_request, listener) => {
      invalidate = listener;
      return removed;
    });
  const view = await renderHook(() => useRealtimeSettingsPermission());
  const stopped = jest.fn();
  await act(async () => {
    expect(
      await view.result.current.authorize('synthetic-voice', stopped),
    ).toBe(true);
  });
  const request = jest.mocked(mockConsent.authorize).mock.calls[0][0];
  expect(request).toMatchObject({
    providerId: 'openai-realtime',
    modelId: 'synthetic-voice',
    recipient: 'OpenAI Realtime API',
    consentScope: { purpose: 'realtime_audio' },
  });
  expect(mockConsent.subscribeAuthorizationInvalidation).toHaveBeenCalledWith(
    request,
    expect.any(Function),
  );
  await act(async () => {
    invalidate();
  });
  expect(request.signal.aborted).toBe(true);
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(1);
  expect(view.result.current.current()).toBe(false);
});

it('cannot resurrect a stopped pending approval and treats storage failure as denied', async () => {
  let complete!: (value: 'authorized') => void;
  let request!: OutboundProcessingRequest;
  jest.mocked(mockConsent.authorize).mockImplementationOnce(value => {
    request = value;
    return new Promise(resolve => {
      complete = resolve;
    });
  });
  const view = await renderHook(() => useRealtimeSettingsPermission());
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = view.result.current.authorize('synthetic-voice', jest.fn());
  });
  await act(async () => {
    view.result.current.stop();
    complete('authorized');
  });
  expect(await pending).toBe(false);
  expect(request.signal.aborted).toBe(true);
  jest
    .mocked(mockConsent.authorize)
    .mockRejectedValueOnce(new Error('Synthetic Keychain error'));
  await act(async () => {
    expect(
      await view.result.current.authorize('synthetic-voice', jest.fn()),
    ).toBe(false);
  });
  expect(view.result.current.current()).toBe(false);
});

it('cleans synchronous invalidation during subscription and denies without a live fence', async () => {
  const removed = jest.fn();
  jest
    .mocked(mockConsent.subscribeAuthorizationInvalidation!)
    .mockImplementation((_request, listener) => {
      listener();
      return removed;
    });
  const view = await renderHook(() => useRealtimeSettingsPermission());
  await act(async () => {
    expect(
      await view.result.current.authorize('synthetic-voice', jest.fn()),
    ).toBe(false);
  });
  expect(removed).toHaveBeenCalledTimes(1);
  jest
    .mocked(mockConsent.subscribeAuthorizationInvalidation!)
    .mockReturnValue(() => {});
  jest.mocked(mockConsent.isAuthorizationCurrent!).mockReturnValue(false);
  await act(async () => {
    expect(
      await view.result.current.authorize('synthetic-voice', jest.fn()),
    ).toBe(false);
  });
  expect(view.result.current.current()).toBe(false);
});
