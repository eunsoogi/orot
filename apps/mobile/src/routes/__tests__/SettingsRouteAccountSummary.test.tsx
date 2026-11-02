import { render, screen, within } from '@testing-library/react-native';
import { t } from '../../i18n';
import type { OpenAIAccountSummary } from '../../providers/openai';
import { SettingsRoute } from '../SettingsRoute';
import { settingsRouteResolverOptions } from '../settingsRouteTestSupport';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function settingsScreen(
  selectedAiResolverOptions: ReturnType<typeof settingsRouteResolverOptions>,
  selectedProvider = '',
) {
  return (
    <SettingsRoute
      selectedProvider={selectedProvider}
      selectedAiResolverOptions={selectedAiResolverOptions}
      onOpenProviderSettings={jest.fn()}
      onOpenAccounts={jest.fn()}
      onOpenPrivacy={jest.fn()}
      onOpenBackup={jest.fn()}
      onOpenHealthData={jest.fn()}
      onOpenSyncStatus={jest.fn()}
    />
  );
}

function renderSettings(
  selectedAiResolverOptions: ReturnType<typeof settingsRouteResolverOptions>,
  selectedProvider = '',
) {
  return render(settingsScreen(selectedAiResolverOptions, selectedProvider));
}

beforeEach(() => {
  mockFocused = true;
});

test('shows the saved AI and connected account count from current account state', async () => {
  const listAccounts = jest.fn(
    async (): Promise<readonly OpenAIAccountSummary[]> => [
      {
        issuedClientID: 'connected-account',
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ],
  );
  await renderSettings(settingsRouteResolverOptions(undefined, listAccounts));

  expect(await screen.findByText('Apple Intelligence')).toBeTruthy();
  expect(screen.queryByText('Stale cached label')).toBeNull();
  expect(
    within(screen.getByTestId('settings-open-accounts')).getByText(
      t('provider.selection.chatGPTAccountsConnected', { count: 1 }),
    ),
  ).toBeTruthy();
  expect(listAccounts).toHaveBeenCalledTimes(1);
});

test('summarizes signed-out and scope-limited accounts without counting them as connected', async () => {
  const listAccounts = jest.fn(
    async (): Promise<readonly OpenAIAccountSummary[]> => [
      {
        issuedClientID: 'connected-account',
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
      {
        issuedClientID: 'signed-out-account',
        requiresSignIn: true,
        hasDirectPlanAccess: false,
      },
      {
        issuedClientID: 'scope-limited-account',
        requiresSignIn: false,
        hasDirectPlanAccess: false,
      },
    ],
  );
  await renderSettings(settingsRouteResolverOptions(undefined, listAccounts));

  expect(
    await screen.findByText(
      t('provider.selection.chatGPTAccountsOverview', {
        connected: 1,
        signInRequired: 1,
        missingScope: 1,
      }),
    ),
  ).toBeTruthy();
});

test('shows no saved AI and no linked accounts as honest empty states', async () => {
  await renderSettings(settingsRouteResolverOptions(null));

  expect(
    await screen.findByText(t('provider.selection.selectPrompt')),
  ).toBeTruthy();
  expect(
    await screen.findByText(t('provider.selection.chatGPTNoLinkedAccounts')),
  ).toBeTruthy();
});

test('shows account and selected AI read errors without a connected fallback', async () => {
  const listAccounts = jest.fn(async () => {
    throw new Error('account status unavailable');
  });
  const options = settingsRouteResolverOptions(
    { providerId: 'chatgpt-plan:missing-account:model-a', modelId: 'model-a' },
    listAccounts,
  );
  await renderSettings(options, 'Stale cached label');

  expect(
    await screen.findByText(t('provider.selection.rowUnavailable')),
  ).toBeTruthy();
  expect(screen.queryByText('Stale cached label')).toBeNull();
  expect(
    await screen.findByText(t('provider.selection.chatGPTAccountReadError')),
  ).toBeTruthy();
  expect(
    screen.queryByText(
      t('provider.selection.chatGPTAccountsConnected', { count: 1 }),
    ),
  ).toBeNull();
  expect(listAccounts).toHaveBeenCalledTimes(1);
});

test('refreshes saved AI and account summaries when Settings regains focus', async () => {
  let accounts: readonly OpenAIAccountSummary[] = [];
  const listAccounts = jest.fn(async () => accounts);
  const options = settingsRouteResolverOptions(undefined, listAccounts);
  const { rerender } = await renderSettings(options);

  expect(
    await screen.findByText(t('provider.selection.chatGPTNoLinkedAccounts')),
  ).toBeTruthy();

  mockFocused = false;
  await rerender(settingsScreen(options));
  accounts = [
    {
      issuedClientID: 'newly-linked-account',
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    },
  ];
  mockFocused = true;
  await rerender(settingsScreen(options));

  expect(
    await screen.findByText(
      t('provider.selection.chatGPTAccountsConnected', { count: 1 }),
    ),
  ).toBeTruthy();
  expect(listAccounts).toHaveBeenCalledTimes(2);
});
