import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import * as nativeExecution from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({
  AppSymbol: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

/** Gate ordering is deterministic cloud evidence, not elapsed native rendering time. */
test('verified Conversation label waits for its own catalog, never an unrelated Apple gate', async () => {
  const apple = deferred<ReturnType<typeof createAppleSelectionOption>>();
  const accounts =
    deferred<Awaited<ReturnType<ChatGPTSelectionServices['listAccounts']>>>();
  const catalog =
    deferred<Awaited<ReturnType<ChatGPTSelectionServices['listModels']>>>();
  const loadAppleOption = jest.fn(() => apple.promise);
  const listAccounts = jest.fn(() => accounts.promise);
  const listModels = jest.fn(() => catalog.promise);
  const load = jest.fn(async () => ({
    providerId: 'chatgpt-plan:synthetic-account:synthetic-model',
    modelId: 'synthetic-model',
  }));
  const onPress = jest.fn();
  const resolveSelectedAi = () =>
    resolveSelectedAiProvider({
      selectionStore: { load, save: jest.fn(), clear: jest.fn() },
      loadAppleOption,
      chatGPTServices: {
        listAccounts,
        listModels,
        signIn: jest.fn(),
        signOut: jest.fn(),
        cancelSignIn: jest.fn(),
      },
    });
  const view = await render(
    <AiProviderSelectorRow
      onPress={onPress}
      resolveSelectedAi={resolveSelectedAi}
      revision={0}
    />,
  );
  const control = () => screen.getByTestId('ai-feature-select-provider');
  expect(control().props.accessibilityState.busy).toBe(true);
  expect(screen.queryByText('Synthetic verified model')).toBeNull();
  expect(listAccounts).toHaveBeenCalledTimes(1);
  expect(listModels).not.toHaveBeenCalled();
  expect(loadAppleOption).not.toHaveBeenCalled();

  await act(async () =>
    accounts.resolve([
      {
        issuedClientID: 'synthetic-account',
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ]),
  );
  expect(listModels).toHaveBeenCalledWith('synthetic-account');
  expect(control().props.accessibilityState.busy).toBe(true);
  expect(screen.queryByText('Synthetic verified model')).toBeNull();

  await act(async () =>
    catalog.resolve({
      ok: true,
      value: [
        {
          id: 'synthetic-model',
          slug: 'synthetic-model',
          displayName: 'Synthetic verified model',
        },
      ],
    }),
  );
  expect(screen.getByText('Synthetic verified model')).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(false);
  expect(load).toHaveBeenCalledTimes(1);
  expect(listModels).toHaveBeenCalledTimes(1);
  expect(loadAppleOption).not.toHaveBeenCalled();
  await fireEvent.press(control());
  expect(onPress).toHaveBeenCalledTimes(1);
  // A later unrelated native availability result cannot change the selected identity.
  await act(async () =>
    apple.resolve(createAppleSelectionOption('unavailable')),
  );
  expect(screen.getByText('Synthetic verified model')).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(false);
  await view.unmount();
});

function protectedForegroundFixture() {
  let listener: (event: ConversationExecutionEvent) => void = () => {};
  const protectedDataAvailable = jest.fn(async () => true);
  jest.spyOn(nativeExecution, 'conversationExecutionNative').mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => true,
    end() {},
    isActive: async () => true,
    protectedDataAvailable,
    subscribe(value) {
      listener = value;
      return () => {};
    },
  });
  return {
    emit: (event: ConversationExecutionEvent) => listener(event),
    protectedDataAvailable,
  };
}

test('shows the exact bundled saved name before native readiness, then clears it on invalidation', async () => {
  protectedForegroundFixture();
  const option = createAppleSelectionOption('available');
  const availability = deferred<typeof option>();
  const local = deferred<{ providerId: string; modelId: string }>();
  let current = true;
  let invalidate: () => void = () => {};
  const unsubscribe = jest.fn();
  const load = jest
    .spyOn(providerSelectionStore, 'load')
    .mockReturnValue(local.promise);
  jest
    .spyOn(providerSelectionStore, 'liveWitness')
    .mockImplementation(() => () => current);
  jest
    .spyOn(providerSelectionStore, 'subscribeChanges')
    .mockImplementation(listener => {
      invalidate = listener;
      return unsubscribe;
    });
  const loadAppleOption = jest.fn(() => availability.promise);
  const resolveSelectedAi: ResolveConversationModelDisplay = observer =>
    resolveSelectedAiProvider({ loadAppleOption }, observer);
  try {
    const view = await render(
      <AiProviderSelectorRow
        onPress={jest.fn()}
        resolveSelectedAi={resolveSelectedAi}
        revision={0}
      />,
    );
    const row = () => screen.getByTestId('ai-feature-select-provider');
    expect(row().props.accessibilityState.busy).toBe(true);
    expect(screen.queryByText(option.displayName)).toBeNull();
    await act(async () =>
      local.resolve({
        providerId: option.provider.id,
        modelId: option.modelId,
      }),
    );
    expect(screen.getByText(option.displayName)).toBeTruthy();
    expect(row().props.accessibilityState.busy).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(loadAppleOption).toHaveBeenCalledTimes(1);

    await act(() => {
      current = false;
      invalidate();
    });
    expect(screen.queryByText(option.displayName)).toBeNull();
    await act(async () => availability.resolve(option));
    expect(screen.queryByText(option.displayName)).toBeNull();

    // A clean revision uses its own witness and only native availability clears busy.
    current = true;
    await view.rerender(
      <AiProviderSelectorRow
        onPress={jest.fn()}
        resolveSelectedAi={resolveSelectedAi}
        revision={1}
      />,
    );
    expect(screen.getByText(option.displayName)).toBeTruthy();
    expect(row().props.accessibilityState.busy).toBe(false);
    await view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  } finally {
    jest.restoreAllMocks();
  }
});
