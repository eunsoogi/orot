import { act, render, screen } from '@testing-library/react-native';
import { t } from '../../../i18n';
import type { ProviderSelectionOption } from '../../../providers/selection/types';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import {
  APPLE_PCC_MODEL_ID,
  APPLE_PCC_PROVIDER_ID,
} from '../../../providers/selection/privateCloudCompute';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import * as nativeExecution from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const option = createAppleSelectionOption('available');
const local = { providerId: option.provider.id, modelId: option.modelId };
const pcc = { providerId: APPLE_PCC_PROVIDER_ID, modelId: APPLE_PCC_MODEL_ID };
const remote = {
  providerId: 'chatgpt-plan:synthetic-account:synthetic-model',
  modelId: 'synthetic-model',
};
const control = () => screen.getByTestId('ai-feature-select-provider');
const shownName = () => screen.queryByText(option.displayName);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}
function fixture() {
  let listener: (event: ConversationExecutionEvent) => void = () => {};
  let selectChanged = () => {};
  let ownsSelection = true;
  const protectedDataAvailable = jest.fn(async () => true);
  const load = jest
    .spyOn(providerSelectionStore, 'load')
    .mockResolvedValue(local);
  jest
    .spyOn(providerSelectionStore, 'liveWitness')
    .mockImplementation(() => () => ownsSelection);
  jest
    .spyOn(providerSelectionStore, 'subscribeChanges')
    .mockImplementation(next => {
      selectChanged = next;
      return () => {};
    });
  jest.spyOn(nativeExecution, 'conversationExecutionNative').mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: async () => true,
    end() {},
    isActive: async () => true,
    protectedDataAvailable,
    subscribe(next) {
      listener = next;
      return () => {};
    },
  });
  const first = deferred<typeof option>();
  const second = deferred<typeof option>();
  const loadAppleOption = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const loadPccOption = jest.fn().mockResolvedValue(option);
  const listAccounts = jest.fn<
    ReturnType<ChatGPTSelectionServices['listAccounts']>,
    []
  >(async () => []);
  const listModels = jest.fn();
  const services: ChatGPTSelectionServices = {
    listAccounts,
    listModels,
    signIn: jest.fn(),
    signOut: jest.fn(),
    cancelSignIn: jest.fn(),
  };
  const resolve: ResolveConversationModelDisplay = display =>
    resolveSelectedAiProvider(
      { loadAppleOption, loadPccOption, chatGPTServices: services },
      display,
    );
  return {
    load,
    first,
    second,
    loadAppleOption,
    loadPccOption,
    listAccounts,
    listModels,
    protectedDataAvailable,
    resolve,
    emit: (event: ConversationExecutionEvent) => listener(event),
    invalidate() {
      ownsSelection = false;
      selectChanged();
    },
  };
}

function mount(resolve: ResolveConversationModelDisplay) {
  return render(
    <AiProviderSelectorRow
      resolveSelectedAi={resolve}
      revision={0}
      onPress={jest.fn()}
    />,
  );
}
afterEach(() => jest.restoreAllMocks());

test('lock hides the saved label and ignores late readiness until an exact fresh foreground read', async () => {
  const f = fixture();
  const view = await mount(f.resolve);
  expect(shownName()).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(true);
  await act(() => f.emit({ kind: 'protectedData', available: false }));
  expect(shownName()).toBeNull();
  await act(() => f.first.resolve(option));
  expect(shownName()).toBeNull();
  await act(() => f.emit({ kind: 'phase' }));
  await act(() => f.emit({ kind: 'protectedData', available: true }));
  expect(shownName()).toBeNull();
  await act(() => f.emit({ kind: 'foreground' }));
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(f.loadAppleOption).toHaveBeenCalledTimes(2);
  expect(shownName()).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(true);
  await act(() => f.second.resolve(option));
  expect(control().props.accessibilityState.busy).toBe(false);
  await view.unmount();
});

test('a retained foreground read cannot request another provider after the local selection changes', async () => {
  const f = fixture();
  const view = await mount(f.resolve);
  expect(shownName()).toBeTruthy();
  await act(() => f.emit({ kind: 'phase' }));
  f.load.mockResolvedValue(remote);
  await act(() => f.emit({ kind: 'foreground' }));
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(f.listAccounts).not.toHaveBeenCalled();
  expect(f.loadPccOption).not.toHaveBeenCalled();
  expect(shownName()).toBeNull();
  await view.unmount();
});

test('save invalidation before the pending Keychain read prevents name and ready publication', async () => {
  const f = fixture();
  const pending = deferred<typeof local>();
  f.load.mockReturnValueOnce(pending.promise);
  const view = await mount(f.resolve);
  await act(() => f.invalidate());
  await act(() => pending.resolve(local));
  await act(() => f.first.resolve(option));
  expect(shownName()).toBeNull();
  await view.unmount();
});

test('PCC needs protected data for its saved name and stays unavailable when approval fails', async () => {
  const f = fixture();
  const protection = deferred<boolean>();
  const availability = deferred<ProviderSelectionOption>();
  f.load.mockResolvedValue(pcc);
  f.protectedDataAvailable.mockReturnValueOnce(protection.promise);
  f.loadPccOption.mockReturnValue(availability.promise);
  const view = await mount(f.resolve);
  expect(f.loadPccOption).toHaveBeenCalledTimes(1);
  expect(f.loadAppleOption).not.toHaveBeenCalled();
  expect(f.protectedDataAvailable).toHaveBeenCalledTimes(1);
  expect(shownName()).toBeNull();
  expect(control().props.accessibilityState.busy).toBe(true);
  await act(() => protection.resolve(true));
  expect(shownName()).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(true);
  await act(() =>
    availability.resolve({
      ...option,
      provider: { ...option.provider, id: pcc.providerId },
      modelId: pcc.modelId,
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'unavailable', message: 'Approval denied' },
    }),
  );
  expect(shownName()).toBeNull();
  expect(screen.getByText(t('provider.selection.rowUnavailable'))).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(false);
  await view.unmount();
});

test('an old protected-data snapshot cannot re-expose a locked local result', async () => {
  const f = fixture();
  const oldProtection = deferred<boolean>();
  f.protectedDataAvailable.mockReturnValueOnce(oldProtection.promise);
  const view = await mount(f.resolve);
  expect(shownName()).toBeNull();
  await act(() => f.emit({ kind: 'protectedData', available: false }));
  await act(() => oldProtection.resolve(true));
  await act(() => f.first.resolve(option));
  expect(shownName()).toBeNull();
  expect(f.load).toHaveBeenCalledTimes(1);
  await act(() => f.emit({ kind: 'protectedData', available: true }));
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(shownName()).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(true);
  await view.unmount();
});

test('the default ChatGPT selection remains unnamed until its own held catalog settles', async () => {
  const f = fixture();
  const catalog =
    deferred<Awaited<ReturnType<ChatGPTSelectionServices['listModels']>>>();
  f.load.mockResolvedValue(remote);
  f.listAccounts.mockResolvedValue([
    {
      issuedClientID: 'synthetic-account',
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    },
  ]);
  f.listModels.mockReturnValue(catalog.promise);
  const view = await mount(f.resolve);
  expect(f.listModels).toHaveBeenCalledWith('synthetic-account');
  expect(control().props.accessibilityState.busy).toBe(true);
  expect(screen.queryByText('Synthetic verified ChatGPT')).toBeNull();
  expect(shownName()).toBeNull();
  expect(f.protectedDataAvailable).not.toHaveBeenCalled();
  await act(() =>
    catalog.resolve({
      ok: true,
      value: [
        {
          id: 'synthetic-model',
          slug: 'synthetic-model',
          displayName: 'Synthetic verified ChatGPT',
        },
      ],
    }),
  );
  expect(screen.getByText('Synthetic verified ChatGPT')).toBeTruthy();
  expect(control().props.accessibilityState.busy).toBe(false);
  await view.unmount();
});
