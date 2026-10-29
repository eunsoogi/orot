import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ProviderCatalogAccount } from '../ProviderCatalogAccount';
import type { ChatGPTAccountSetup } from '../types';
import { providerSelectionText } from '../text';

function createAccountSetup(
  overrides: Partial<ChatGPTAccountSetup> = {},
): ChatGPTAccountSetup {
  // Presentation tests start from a ready synthetic account unless a state is under test.
  return {
    presentation: 'feature',
    accounts: [
      {
        issuedClientID: 'synthetic-account',
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      },
    ],
    selectedAccountID: 'synthetic-account',
    statusMessage: '',
    statusIsError: false,
    actionTitle: providerSelectionText.chatGPTLoadModels,
    busy: false,
    signingIn: false,
    signingOut: false,
    actionDisabled: false,
    onAccountSelected() {},
    onAction() {},
    onSignOut() {},
    onCancelSignIn() {},
    ...overrides,
  };
}

test('names the icon-only model action for VoiceOver after loading', async () => {
  const onAction = jest.fn();
  await render(
    <ProviderCatalogAccount
      setup={createAccountSetup({
        statusMessage: providerSelectionText.chatGPTModelsLoaded,
        onAction,
      })}
    />,
  );

  const action = screen.getByTestId('chatgpt-account-action');
  expect(action.props.accessibilityRole).toBe('button');
  expect(action.props.accessibilityLabel).toBe('모델 새로고침');
  expect(action.props.accessibilityState).toMatchObject({
    disabled: false,
    busy: false,
  });
  expect(action.props.style).toMatchObject({ width: 44, height: 44 });
  expect(screen.queryByText('모델 새로고침')).toBeNull();
  await fireEvent.press(action);
  expect(onAction).toHaveBeenCalledTimes(1);
});

test('announces model errors and keeps the icon available for retry', async () => {
  const onAction = jest.fn();
  await render(
    <ProviderCatalogAccount
      setup={createAccountSetup({
        statusMessage: providerSelectionText.chatGPTModelsUnavailable,
        statusIsError: true,
        onAction,
      })}
    />,
  );

  const action = screen.getByTestId('chatgpt-account-action');
  expect(
    screen.getByTestId('chatgpt-account-status').props.accessibilityRole,
  ).toBe('alert');
  expect(action.props.accessibilityLabel).toBe(
    providerSelectionText.chatGPTLoadModels,
  );
  expect(action.props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(action);
  expect(onAction).toHaveBeenCalledTimes(1);
});

test('exposes loading and disables repeated model actions', async () => {
  const onAction = jest.fn();
  await render(
    <ProviderCatalogAccount
      setup={createAccountSetup({
        busy: true,
        actionDisabled: true,
        onAction,
      })}
    />,
  );

  const action = screen.getByTestId('chatgpt-account-action');
  expect(action.props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
  await fireEvent.press(action);
  expect(onAction).not.toHaveBeenCalled();
});

test('keeps long Korean permission copy in a not-ready account text column', async () => {
  await render(
    <ProviderCatalogAccount
      setup={createAccountSetup({
        accounts: [
          {
            issuedClientID: 'synthetic-account',
            requiresSignIn: false,
            hasDirectPlanAccess: false,
          },
        ],
        actionTitle: providerSelectionText.chatGPTReauthorize,
      })}
    />,
  );

  const account = screen.getByTestId('chatgpt-account-0');
  const permission = screen.getByTestId('chatgpt-account-permission-0');
  expect(permission.props.children).toBe(
    providerSelectionText.chatGPTAccountMissingScope,
  );
  expect(permission.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(permission.props.style)).toMatchObject({
    flexShrink: 1,
    minWidth: 0,
  });
  expect(account.props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('chatgpt-account-action')).toBeTruthy();
});
