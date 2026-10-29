import { fireEvent, render, screen } from '@testing-library/react-native';
import SettingsAccountsPanels from '../SettingsAccountsPanels';
import { providerSelectionText } from '../text';
import type { ChatGPTAccountSetup } from '../types';

// Synthetic account fixtures keep these presentation checks off real auth services.
const signedOutAccount = {
  issuedClientID: 'synthetic-signed-out',
  requiresSignIn: true,
  hasDirectPlanAccess: false,
};
const connectedAccount = {
  issuedClientID: 'synthetic-connected',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};
const missingScopeAccount = {
  issuedClientID: 'synthetic-missing-scope',
  requiresSignIn: false,
  hasDirectPlanAccess: false,
};

function makeSetup(
  overrides: Partial<ChatGPTAccountSetup> = {},
): ChatGPTAccountSetup {
  return {
    presentation: 'settings-accounts',
    accounts: [],
    selectedAccountID: null,
    statusMessage: '',
    statusIsError: false,
    actionTitle: providerSelectionText.chatGPTSignIn,
    busy: false,
    signingIn: false,
    signingOut: false,
    actionDisabled: false,
    onAccountSelected: jest.fn(),
    onAction: jest.fn(),
    onSignOut: jest.fn(),
    onCancelSignIn: jest.fn(),
    ...overrides,
  };
}

test('shows the empty connection state beside its original sign-in action', async () => {
  const onAction = jest.fn();
  await render(
    <SettingsAccountsPanels
      setup={makeSetup({
        statusMessage: providerSelectionText.chatGPTNoAccounts,
        onAction,
      })}
    />,
  );

  expect(screen.getByTestId('settings-accounts-list')).toBeTruthy();
  expect(screen.getByTestId('settings-accounts-actions')).toBeTruthy();
  expect(screen.queryByTestId('settings-accounts-panels-secondary')).toBeNull();
  expect(
    screen.getByText(providerSelectionText.chatGPTNoAccounts),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chatgpt-account-action'));
  expect(onAction).toHaveBeenCalledTimes(1);
});

test('keeps account selection accessible and routes a sign-in action', async () => {
  const onAccountSelected = jest.fn();
  const onAction = jest.fn();
  await render(
    <SettingsAccountsPanels
      setup={makeSetup({
        accounts: [signedOutAccount, missingScopeAccount],
        selectedAccountID: signedOutAccount.issuedClientID,
        actionTitle: providerSelectionText.chatGPTReauthorize,
        onAccountSelected,
        onAction,
      })}
    />,
  );

  expect(
    screen.getByTestId('chatgpt-account-0').props.accessibilityState,
  ).toEqual({
    disabled: false,
    selected: true,
  });
  expect(
    screen.getByText(providerSelectionText.chatGPTAccountSignedOut),
  ).toBeTruthy();
  expect(
    screen.getByText(providerSelectionText.chatGPTAccountMissingScope),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('chatgpt-account-1'));
  expect(onAccountSelected).toHaveBeenCalledWith(
    missingScopeAccount.issuedClientID,
  );
  await fireEvent.press(screen.getByTestId('chatgpt-account-action'));
  expect(onAction).toHaveBeenCalledTimes(1);
});

test('announces account-load errors and disables stale actions while loading', async () => {
  const onAction = jest.fn();
  await render(
    <SettingsAccountsPanels
      setup={makeSetup({
        accounts: [signedOutAccount],
        selectedAccountID: signedOutAccount.issuedClientID,
        statusMessage: providerSelectionText.chatGPTAccountReadError,
        statusIsError: true,
        actionTitle: providerSelectionText.chatGPTChecking,
        busy: true,
        actionDisabled: true,
        onAction,
      })}
    />,
  );

  expect(
    screen.getByTestId('chatgpt-account-status').props.accessibilityRole,
  ).toBe('alert');
  expect(
    screen.getByTestId('chatgpt-account-0').props.accessibilityState,
  ).toEqual({
    disabled: true,
    selected: true,
  });
  expect(
    screen.getByTestId('chatgpt-account-action').props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(
    screen.getByText(providerSelectionText.chatGPTAccountReadError),
  ).toBeTruthy();
  expect(onAction).not.toHaveBeenCalled();
});

test('preserves the connected account sign-out target and progress label', async () => {
  const onSignOut = jest.fn();
  const { rerender } = await render(
    <SettingsAccountsPanels
      setup={makeSetup({
        accounts: [connectedAccount],
        selectedAccountID: connectedAccount.issuedClientID,
        onSignOut,
      })}
    />,
  );

  await fireEvent.press(screen.getByTestId('chatgpt-account-sign-out'));
  expect(onSignOut).toHaveBeenCalledWith(connectedAccount.issuedClientID);
  await rerender(
    <SettingsAccountsPanels
      setup={makeSetup({
        accounts: [connectedAccount],
        selectedAccountID: connectedAccount.issuedClientID,
        signingOut: true,
        busy: true,
        onSignOut,
      })}
    />,
  );

  expect(
    screen.getByText(providerSelectionText.chatGPTSigningOut(1)),
  ).toBeTruthy();
  expect(
    screen.getByTestId('chatgpt-account-sign-out').props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(screen.queryByTestId('chatgpt-account-action')).toBeNull();
});

test('keeps sign-in cancellation available during account progress', async () => {
  const onCancelSignIn = jest.fn();
  await render(
    <SettingsAccountsPanels
      setup={makeSetup({
        signingIn: true,
        busy: true,
        actionDisabled: true,
        onCancelSignIn,
      })}
    />,
  );

  await fireEvent.press(screen.getByTestId('chatgpt-cancel-sign-in'));
  expect(onCancelSignIn).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('chatgpt-account-action')).toBeNull();
});
