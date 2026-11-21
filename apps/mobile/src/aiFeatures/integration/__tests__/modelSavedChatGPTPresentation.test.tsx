import { act, render, screen } from '@testing-library/react-native';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { chatGPTCredentialMutation } from '../../../providers/chatGPTConsentIdentity';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import * as native from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const exactAccount = 'fake-account';
function setup(modelId = 'gpt-6.2-sol') {
  const providerId = `chatgpt-plan:${exactAccount}:${modelId}`;
  const accounts =
    deferred<Awaited<ReturnType<ChatGPTSelectionServices['listAccounts']>>>();
  const catalog =
    deferred<Awaited<ReturnType<ChatGPTSelectionServices['listModels']>>>();
  const listAccounts = jest.fn(() => accounts.promise);
  const listModels = jest.fn(() => catalog.promise);
  const load = jest
    .spyOn(providerSelectionStore, 'load')
    .mockResolvedValue({ modelId, providerId });
  jest.spyOn(providerSelectionStore, 'liveWitness').mockReturnValue(() => true);
  let event = (_event: ConversationExecutionEvent) => {};
  jest.spyOn(native, 'conversationExecutionNative').mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: jest.fn(async () => true),
    end: jest.fn(),
    isActive: jest.fn(async () => true),
    protectedDataAvailable: jest.fn(async () => true),
    subscribe(listener) {
      event = listener;
      return () => {};
    },
  });
  const resolveSelectedAi: ResolveConversationModelDisplay = observer =>
    resolveSelectedAiProvider(
      {
        chatGPTServices: {
          listAccounts,
          listModels,
          signIn: jest.fn(),
          signOut: jest.fn(),
          cancelSignIn: jest.fn(),
        },
      },
      observer,
    );
  const accountReady = () =>
    act(async () =>
      accounts.resolve([
        {
          issuedClientID: exactAccount,
          requiresSignIn: false,
          hasDirectPlanAccess: true,
        },
      ]),
    );
  const ready = () =>
    act(async () =>
      catalog.resolve({
        ok: true,
        value: [
          {
            id: providerId,
            slug: modelId,
            displayName: 'Verified catalog name',
          },
        ],
      }),
    );
  const row = () => screen.getByTestId('ai-feature-select-provider');
  const mount = (revision: number) => (
    <AiProviderSelectorRow
      onPress={jest.fn()}
      revision={revision}
      resolveSelectedAi={resolveSelectedAi}
    />
  );
  return {
    accounts,
    accountReady,
    ready,
    row,
    mount,
    listAccounts,
    listModels,
    load,
    event: (value: ConversationExecutionEvent) => event(value),
    catalog,
  };
}

afterEach(() => jest.restoreAllMocks());

test('known saved ChatGPT identity shows while its catalog is held, including warm rerender', async () => {
  const f = setup();
  const view = await render(f.mount(0));
  expect(screen.queryByText('GPT-6.2 Sol')).toBeNull();
  await f.accountReady();
  expect(screen.getByText('GPT-6.2 Sol')).toBeTruthy();
  expect(f.row().props.accessibilityState.busy).toBe(true);
  expect(f.row().props.accessibilityLabel).toContain(
    '저장된 선택: GPT-6.2 Sol',
  );
  expect(screen.queryByText('Verified catalog name')).toBeNull();
  expect(f.load).toHaveBeenCalledTimes(1);
  expect(f.listAccounts).toHaveBeenCalledTimes(1);
  expect(f.listModels).toHaveBeenCalledTimes(1);
  await view.rerender(f.mount(1));
  expect(screen.getByText('GPT-6.2 Sol')).toBeTruthy();
  expect(f.row().props.accessibilityState.busy).toBe(true);
  await f.ready();
  expect(screen.getByText('Verified catalog name')).toBeTruthy();
  expect(f.row().props.accessibilityState.busy).toBe(false);
});

test.each(['credential rotation', 'background'] as const)(
  'late catalog cannot revive the saved label after %s',
  async scenario => {
    const f = setup();
    let finish = () => {};
    try {
      await render(f.mount(0));
      await f.accountReady();
      expect(screen.getByText('GPT-6.2 Sol')).toBeTruthy();
      await act(() => {
        if (scenario === 'credential rotation')
          finish = chatGPTCredentialMutation.begin();
        else f.event({ kind: 'phase' });
      });
      await f.ready();
      expect(screen.queryByText('GPT-6.2 Sol')).toBeNull();
      expect(screen.queryByText('Verified catalog name')).toBeNull();
      expect(f.listModels).toHaveBeenCalledTimes(1);
    } finally {
      finish();
    }
  },
);

test('an unknown saved id is not rendered before verified catalog ownership', async () => {
  const f = setup('opaque-custom-label');
  await render(f.mount(0));
  await f.accountReady();
  expect(screen.queryByText('opaque-custom-label')).toBeNull();
  expect(f.row().props.accessibilityState.busy).toBe(true);
  await f.ready();
  expect(screen.getByText('Verified catalog name')).toBeTruthy();
});

test.each(['different-account', 'needs-sign-in'] as const)(
  'no early name or catalog lookup for %s',
  async variant => {
    const f = setup();
    await render(f.mount(0));
    await act(async () =>
      f.accounts.resolve([
        {
          issuedClientID:
            variant === 'different-account' ? 'another-account' : exactAccount,
          requiresSignIn: variant === 'needs-sign-in',
          hasDirectPlanAccess: true,
        },
      ]),
    );
    expect(screen.queryByText('GPT-6.2 Sol')).toBeNull();
    expect(f.listModels).not.toHaveBeenCalled();
    expect(screen.getByText('선택한 AI를 확인할 수 없어요.')).toBeTruthy();
  },
);
