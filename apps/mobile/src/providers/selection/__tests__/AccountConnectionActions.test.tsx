import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AccountConnectionActions } from '../AccountConnectionActions';
import type { ChatGPTAccountSetup } from '../types';

const account = {
  issuedClientID: 'synthetic',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};
function setup(): ChatGPTAccountSetup {
  return {
    presentation: 'settings-accounts',
    accounts: [account],
    selectedAccountID: account.issuedClientID,
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
}
afterEach(() => jest.restoreAllMocks());
test('cancel and repeated taps never sign out, confirmation executes once', async () => {
  const state = setup();
  const alert = jest.spyOn(Alert, 'alert');
  const view = await render(<AccountConnectionActions setup={state} />);
  const press = () =>
    fireEvent.press(view.getByTestId('chatgpt-account-sign-out'));
  await press();
  await press();
  expect(alert).toHaveBeenCalledTimes(1);
  alert.mock.calls[0][2]![0].onPress!();
  expect(state.onSignOut).not.toHaveBeenCalled();
  await press();
  const confirm = alert.mock.calls[1][2]![1].onPress!;
  confirm();
  confirm();
  expect(state.onSignOut).toHaveBeenCalledTimes(1);
  expect(state.onSignOut).toHaveBeenCalledWith('synthetic');
});
test.each(['selection', 'busy', 'unmount'])(
  'rejects a stale confirmation after %s',
  async change => {
    const state = setup();
    const alert = jest.spyOn(Alert, 'alert');
    const view = await render(<AccountConnectionActions setup={state} />);
    await fireEvent.press(view.getByTestId('chatgpt-account-sign-out'));
    if (change === 'unmount') await view.unmount();
    else
      await view.rerender(
        <AccountConnectionActions
          setup={{
            ...state,
            selectedAccountID: change === 'selection' ? null : 'synthetic',
            busy: change === 'busy',
          }}
        />,
      );
    alert.mock.calls[0][2]![1].onPress!();
    expect(state.onSignOut).not.toHaveBeenCalled();
  },
);
