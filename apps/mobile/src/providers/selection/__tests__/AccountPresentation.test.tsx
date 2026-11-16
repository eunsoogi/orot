import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import SettingsAccountsPanels from '../SettingsAccountsPanels';
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
  // The API credential editor now embeds the shared account title beside its provider mark.
  // The ChatGPT group retains the shared outer section heading.
  for (const [title, style] of [
    ['ChatGPT', providerSettingsStyles.heading],
    ['OpenAI API', providerSettingsStyles.title],
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
