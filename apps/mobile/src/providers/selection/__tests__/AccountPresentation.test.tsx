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
  const heading = StyleSheet.flatten(providerSettingsStyles.heading);
  for (const title of ['ChatGPT', 'OpenAI API']) {
    expect(
      StyleSheet.flatten(view.getByRole('header', { name: title }).props.style),
    ).toEqual(expect.objectContaining(heading));
  }
  expect(
    StyleSheet.flatten(view.getByTestId('chatgpt-account-action').props.style),
  ).toEqual(StyleSheet.flatten(providerSettingsStyles.action));
  expect(
    view.getByTestId('chatgpt-account-action').props.accessibilityLabel,
  ).toBe('로그인');
});
