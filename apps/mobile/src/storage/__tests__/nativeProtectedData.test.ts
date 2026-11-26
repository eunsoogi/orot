import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { createNativeProtectedDataWitness } from '../nativeProtectedData';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  NativeEventEmitter: jest.fn(),
  NativeModules: {},
  Platform: { OS: 'ios' },
}));

const protectionModule = {
  protectedDataAvailable: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
const nativeRemove = jest.fn();
const phaseRemove = jest.fn();
const addListener = jest.fn(
  (_name: string, _listener: (value: unknown) => void) => ({
    remove: nativeRemove,
  }),
);

beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.ConversationExecutionModule = protectionModule;
  Object.assign(Platform, { OS: 'ios' });
  Object.assign(AppState, { currentState: 'active' });
  Object.assign(NativeEventEmitter.prototype, { addListener });
  jest
    .mocked(AppState.addEventListener)
    .mockReturnValue({ remove: phaseRemove });
});

test('requires the iOS bridge and an explicit positive protection read', async () => {
  Object.assign(Platform, { OS: 'android' });
  expect(createNativeProtectedDataWitness()).toBeNull();
  Object.assign(Platform, { OS: 'ios' });
  delete NativeModules.ConversationExecutionModule;
  expect(createNativeProtectedDataWitness()).toBeNull();
  NativeModules.ConversationExecutionModule = protectionModule;
  const witness = createNativeProtectedDataWitness()!;
  protectionModule.protectedDataAvailable
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('synthetic'));
  await expect(witness.confirmAvailable()).resolves.toBe(true);
  for (let i = 0; i < 3; i += 1)
    await expect(witness.confirmAvailable()).resolves.toBe(false);
});

test('retires on native lock or nonactive AppState, not on execution milestones or unlock', () => {
  const witness = createNativeProtectedDataWitness()!;
  const onLoss = jest.fn();
  const cleanup = witness.subscribeToLoss(onLoss);
  const [, receiveNative] = addListener.mock.calls[0];
  const [, receivePhase] = jest.mocked(AppState.addEventListener).mock.calls[0];
  receiveNative({ kind: 'expired', requestId: 'synthetic' });
  receiveNative({ kind: 'protectedData', available: 'false' });
  receiveNative({ kind: 'protectedData', available: true });
  receivePhase('active');
  expect(onLoss).not.toHaveBeenCalled();
  receiveNative({ kind: 'protectedData', available: false });
  receivePhase('inactive');
  receivePhase('background');
  expect(onLoss).toHaveBeenCalledTimes(3);
  expect(witness.isForeground()).toBe(true);
  Object.assign(AppState, { currentState: 'inactive' });
  expect(witness.isForeground()).toBe(false);
  cleanup();
  expect(nativeRemove).toHaveBeenCalledTimes(1);
  expect(phaseRemove).toHaveBeenCalledTimes(1);
});
