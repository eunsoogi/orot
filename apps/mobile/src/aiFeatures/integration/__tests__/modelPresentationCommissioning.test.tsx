import { act, render, screen } from '@testing-library/react-native';
import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  type AppStateStatus,
} from 'react-native';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const option = createAppleSelectionOption('available');
const shownName = () => screen.queryByText(option.displayName);
const isBusy = () =>
  screen.getByTestId('ai-feature-select-provider').props.accessibilityState
    .busy;

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Mount the real execution-adapter subscription over synthetic RN/Keychain events. */
function fixture(
  initial: AppStateStatus | null,
  protection: Promise<boolean> = Promise.resolve(true),
) {
  const priorPhase = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  const priorModule = Object.getOwnPropertyDescriptor(
    NativeModules,
    'ConversationExecutionModule',
  );
  const setCurrentPhase = (value: AppStateStatus | null) =>
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      writable: true,
      value,
    });
  setCurrentPhase(initial);
  const protectedDataAvailable = jest.fn(() => protection);
  Object.defineProperty(NativeModules, 'ConversationExecutionModule', {
    configurable: true,
    value: {
      begin: jest.fn(),
      end: jest.fn(),
      isActive: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
      protectedDataAvailable,
    },
  });

  const removeNative = jest.fn();
  const removeAppState = jest.fn();
  const removeSelection = jest.fn();
  let native = (_value: unknown) => {};
  let phase = (_value: AppStateStatus) => {};
  let selection = () => {};
  jest
    .spyOn(NativeEventEmitter.prototype, 'addListener')
    .mockImplementation((_event, listener) => {
      native = value => listener(value);
      return { remove: removeNative };
    });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      phase = listener;
      return { remove: removeAppState };
    });
  const load = jest.spyOn(providerSelectionStore, 'load').mockResolvedValue({
    providerId: option.provider.id,
    modelId: option.modelId,
  });
  jest.spyOn(providerSelectionStore, 'liveWitness').mockReturnValue(() => true);
  jest
    .spyOn(providerSelectionStore, 'subscribeChanges')
    .mockImplementation(listener => {
      selection = listener;
      return removeSelection;
    });
  const first = held<typeof option>();
  const second = held<typeof option>();
  const available = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const resolve: ResolveConversationModelDisplay = display =>
    resolveSelectedAiProvider({ loadAppleOption: available }, display);
  return {
    resolve,
    load,
    available,
    protectedDataAvailable,
    first,
    second,
    removeNative,
    removeAppState,
    removeSelection,
    emitNative: (event: unknown) => native(event),
    emitPhase(next: AppStateStatus) {
      setCurrentPhase(next);
      phase(next);
    },
    emitSelection: () => selection(),
    restore() {
      jest.restoreAllMocks();
      if (priorPhase)
        Object.defineProperty(AppState, 'currentState', priorPhase);
      else Reflect.deleteProperty(AppState, 'currentState');
      if (priorModule)
        Object.defineProperty(
          NativeModules,
          'ConversationExecutionModule',
          priorModule,
        );
      else Reflect.deleteProperty(NativeModules, 'ConversationExecutionModule');
    },
  };
}

function mount(resolve: ResolveConversationModelDisplay) {
  return render(
    <AiProviderSelectorRow
      onPress={jest.fn()}
      revision={0}
      resolveSelectedAi={resolve}
    />,
  );
}

test.each([null, 'inactive'] as const)(
  'an initial %s AppState cannot publish a saved or verified label before a fresh active read',
  async initial => {
    const f = fixture(initial);
    try {
      const view = await mount(f.resolve);
      expect(f.load).toHaveBeenCalledTimes(1);
      expect(f.protectedDataAvailable).not.toHaveBeenCalled();
      await act(() => f.first.resolve(option));
      expect(shownName()).toBeNull();
      await act(() => f.emitPhase('active'));
      expect(f.protectedDataAvailable).toHaveBeenCalledTimes(1);
      expect(f.load).toHaveBeenCalledTimes(2);
      expect(shownName()).toBeTruthy();
      expect(isBusy()).toBe(true);
      await act(() => f.second.resolve(option));
      expect(isBusy()).toBe(false);
      await view.unmount();
    } finally {
      f.restore();
    }
  },
);

test('unmount tears down real adapter subscriptions and fences held or late callbacks', async () => {
  const protection = held<boolean>();
  const f = fixture('active', protection.promise);
  try {
    const view = await mount(f.resolve);
    expect(f.protectedDataAvailable).toHaveBeenCalledTimes(1);
    expect(f.available).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(f.removeAppState).toHaveBeenCalledTimes(1);
    expect(f.removeNative).toHaveBeenCalledTimes(1);
    expect(f.removeSelection).toHaveBeenCalledTimes(1);
    await act(async () => {
      f.emitPhase('background');
      f.emitNative({ kind: 'protectedData', available: false });
      f.emitPhase('active');
      f.emitNative({ kind: 'protectedData', available: true });
      f.emitSelection();
      protection.resolve(true);
      f.first.resolve(option);
    });
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.available).toHaveBeenCalledTimes(1);
    expect(f.protectedDataAvailable).toHaveBeenCalledTimes(1);
    expect(shownName()).toBeNull();
  } finally {
    f.restore();
  }
});
