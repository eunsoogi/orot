import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import SettingsAccountsPanels from '../SettingsAccountsPanels';
import { ProviderCatalogAccount } from '../ProviderCatalogAccount';
import type { ChatGPTAccountSetup } from '../types';
import { providerSettingsStyles } from '../../../layout/providerSettingsPresentation';

// Synthetic presentation fixture: authentication and stored credentials are not used.
const setup: ChatGPTAccountSetup = {
  presentation: 'settings-accounts',
  accounts: [],
  selectedAccountID: null,
  statusMessage: '',
  statusIsError: false,
  actionTitle: '로그인',
  busy: false,
  signingIn: false,
  signingOut: false,
  actionDisabled: false,
  onAccountSelected: jest.fn(),
  onAction: jest.fn(),
  onSignOut: jest.fn(),
  onCancelSignIn: jest.fn(),
};
test('account sections and actions share the model settings presentation contract', async () => {
  const view = await render(<SettingsAccountsPanels setup={setup} />);
  // Subscription and API identities share peer section headings.
  for (const [title, style] of [
    ['ChatGPT', providerSettingsStyles.heading],
    ['OpenAI API', providerSettingsStyles.heading],
  ] as const) {
    expect(
      StyleSheet.flatten(view.getByRole('header', { name: title }).props.style),
    ).toEqual(expect.objectContaining(StyleSheet.flatten(style)));
  }
  expect(
    StyleSheet.flatten(view.getByTestId('chatgpt-account-action').props.style),
  ).toEqual(StyleSheet.flatten(providerSettingsStyles.action));
  expect(
    view.getByTestId('chatgpt-account-action').props.accessibilityLabel,
  ).toBe('로그인');
});

// The shared mark is mocked only to observe identical component usage, not native pixels.
jest.mock('../OpenAIProviderMark', () => ({
  OpenAIProviderMark: () => {
    const { View } = require('react-native');
    return <View testID="synthetic-openai-mark" />;
  },
}));
test('renders the same mark for subscription and API without changing account selection', async () => {
  const onAccountSelected = jest.fn();
  const view = await render(
    <SettingsAccountsPanels
      setup={{
        ...setup,
        accounts: [
          {
            issuedClientID: 'synthetic-connected',
            requiresSignIn: false,
            hasDirectPlanAccess: true,
          },
        ],
        selectedAccountID: 'synthetic-connected',
        onAccountSelected,
      }}
    />,
  );
  expect(view.getAllByTestId('synthetic-openai-mark')).toHaveLength(2);
  const choice = view.getByTestId('chatgpt-account-0');
  expect(choice.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(choice);
  expect(onAccountSelected).toHaveBeenCalledWith('synthetic-connected');
});

// Layout geometry shares the model card inset without asserting native pixels.
test('keeps refresh centered on the model selection lane when details expand', async () => {
  const onAction = jest.fn();
  const view = await render(
    <ProviderCatalogAccount
      setup={{ ...setup, presentation: 'feature', onAction }}
    />,
  );
  const lane = () =>
    StyleSheet.flatten(
      view.getByTestId('chatgpt-account-action-lane').props.style,
    );
  expect(lane()).toMatchObject({ marginRight: -13, width: 44 });
  expect(lane().position).toBeUndefined();
  expect(lane().top).toBeUndefined();
  expect(
    StyleSheet.flatten(providerSettingsStyles.catalogAccount).padding,
  ).toBeUndefined();
  await fireEvent.press(view.getByTestId('chatgpt-account-details'));
  expect(lane()).toMatchObject({ marginRight: -13, width: 44 });
  await fireEvent.press(view.getByTestId('chatgpt-account-action'));
  expect(onAction).toHaveBeenCalledTimes(1);
});
