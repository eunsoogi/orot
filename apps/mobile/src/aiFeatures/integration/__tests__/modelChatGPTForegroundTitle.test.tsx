import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as credentials from '../../../providers/chatGPTConsentIdentity';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import * as native from '../../../ragConversation/conversationExecutionNative';
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { AiProviderSelectorRow } from '../AiProviderSelectorRow';
import {
  resolveSelectedAiProvider,
  type ResolveConversationModelDisplay,
} from '../provider';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const account = {
  issuedClientID: 'exact-account',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};
const selection = {
  modelId: 'opaque-selected-model',
  providerId: 'chatgpt-plan:exact-account:opaque-selected-model',
};
const nativeCredential = {
  epoch: 'synthetic-credential-generation',
  isCurrent: () => true,
  subscribe: () => () => {},
};
const stored = 'Synthetic private title snapshot';
const fresh = 'Synthetic fresh saved title';
const verified = 'Synthetic verified catalog title';

async function setup() {
  let event = (_event: ConversationExecutionEvent) => {};
  let protectedData: Promise<boolean> = Promise.resolve(true);
  const selected = jest
    .spyOn(providerSelectionStore, 'load')
    .mockResolvedValue(selection);
  jest.spyOn(providerSelectionStore, 'liveWitness').mockReturnValue(() => true);
  const title = jest
    .spyOn(providerSelectionStore, 'loadTitle')
    .mockResolvedValue(stored);
  let previousCurrent = true;
  const credential = jest
    .spyOn(credentials, 'readChatGPTConsentCredential')
    .mockResolvedValue({
      ...nativeCredential,
      isCurrent: () => previousCurrent,
    });
  const listAccounts = jest.fn(async () => [account]);
  const listModels = jest.fn(async () => ({
    ok: true as const,
    value: [
      {
        id: selection.providerId,
        slug: selection.modelId,
        displayName: verified,
      },
    ],
  }));
  const protection = jest.fn(() => protectedData);
  jest.spyOn(native, 'conversationExecutionNative').mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: jest.fn(async () => true),
    end: jest.fn(),
    isActive: jest.fn(async () => true),
    protectedDataAvailable: protection,
    subscribe(listener) {
      event = listener;
      return () => {};
    },
  });
  const resolve: ResolveConversationModelDisplay = observer =>
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
  await render(
    <AiProviderSelectorRow
      onPress={jest.fn()}
      revision={0}
      resolveSelectedAi={resolve}
    />,
  );
  await screen.findByText(verified);
  await waitFor(() => expect(title).toHaveBeenCalledTimes(1));
  expect(
    screen.getByTestId('ai-feature-select-provider').props.accessibilityState
      .busy,
  ).toBe(false);
  title.mockResolvedValue(fresh);
  return {
    selected,
    credential,
    title,
    listAccounts,
    listModels,
    protection,
    revokePrevious() {
      previousCurrent = false;
      credential.mockResolvedValue(nativeCredential);
    },
    setProtection(next: Promise<boolean>) {
      protectedData = next;
    },
    emit: (value: ConversationExecutionEvent) => act(() => event(value)),
  };
}

afterEach(() => jest.restoreAllMocks());

test('same mounted ChatGPT row restores only a fresh saved title after native foreground and fresh protection', async () => {
  const f = await setup();
  let unlock!: (available: boolean) => void;
  f.setProtection(
    new Promise(resolve => {
      unlock = resolve;
    }),
  );
  await f.emit({ kind: 'phase' });
  await f.emit({ kind: 'foreground' });
  expect(screen.queryByText(verified)).toBeNull();
  expect(screen.queryByText(stored)).toBeNull();
  expect(screen.queryByText(fresh)).toBeNull();
  expect(f.title).toHaveBeenCalledTimes(1);
  await act(() => unlock(true));
  expect(await screen.findByText(fresh)).toBeTruthy();
  expect(screen.queryByText(verified)).toBeNull();
  const row = screen.getByTestId('ai-feature-select-provider');
  expect(row.props.accessibilityLabel).toContain(`저장된 선택: ${fresh}`);
  expect(row.props.accessibilityState.busy).toBe(false);
  expect(f.listModels).toHaveBeenCalledTimes(1);
  expect(f.listAccounts).toHaveBeenCalledTimes(2);
  expect(f.title).toHaveBeenCalledTimes(2);
});

test.each([
  'locked',
  'wrong-account',
  'wrong-selection',
  'revoked',
  'replaced-witness',
] as const)('does not restore a title for %s', async mode => {
  const f = await setup();
  await f.emit({ kind: 'phase' });
  if (mode === 'locked') f.setProtection(Promise.resolve(false));
  if (mode === 'wrong-account')
    f.listAccounts.mockResolvedValue([
      { ...account, issuedClientID: 'other-account' },
    ]);
  if (mode === 'wrong-selection')
    f.selected.mockResolvedValue({
      modelId: 'other',
      providerId: 'chatgpt-plan:exact-account:other',
    });
  if (mode === 'revoked') f.credential.mockResolvedValue(null);
  if (mode === 'replaced-witness') f.revokePrevious();
  await f.emit({ kind: 'foreground' });
  expect(screen.queryByText(verified)).toBeNull();
  expect(screen.queryByText(stored)).toBeNull();
  expect(screen.queryByText(fresh)).toBeNull();
  expect(f.title).toHaveBeenCalledTimes(1);
  expect(f.listModels).toHaveBeenCalledTimes(1);
  expect(f.listAccounts).toHaveBeenCalledTimes(
    mode === 'locked' ||
      mode === 'wrong-selection' ||
      mode === 'replaced-witness'
      ? 1
      : 2,
  );
});

test('a second lock during the foreground title read cannot paint its late result', async () => {
  const f = await setup();
  let release!: (title: string) => void;
  f.title.mockReturnValueOnce(
    new Promise(resolve => {
      release = resolve;
    }),
  );
  await f.emit({ kind: 'phase' });
  await f.emit({ kind: 'foreground' });
  await waitFor(() => expect(f.title).toHaveBeenCalledTimes(2));
  await f.emit({ kind: 'protectedData', available: false });
  await act(() => release(fresh));
  expect(screen.queryByText(fresh)).toBeNull();
  expect(screen.queryByText(verified)).toBeNull();
  expect(f.listModels).toHaveBeenCalledTimes(1);
});
