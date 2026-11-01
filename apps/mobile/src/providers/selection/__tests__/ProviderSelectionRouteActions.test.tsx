import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../../navigation/useNavigationPrimaryAction';
import { ProviderSelectionFooter } from '../ProviderSelectionFooter';
import { createAppleSelectionOption } from '../options';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

test('keeps disclosure and summary while routing confirm and cancel through one owner', async () => {
  const confirm = jest.fn();
  const cancel = jest.fn();
  function Fixture({ saving }: { saving: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('provider');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <ProviderSelectionFooter
          option={createAppleSelectionOption('available')}
          resolution={{ ok: true, provider: {} as never }}
          saving={saving}
          message=""
          saveError={false}
          remoteAvailable
          onConfirm={confirm}
          onCancel={cancel}
        />
        <View>
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.label}
              testID={`dock-${action.id}`}
              disabled={action.disabled}
              onPress={() => {
                action.onPress();
              }}
            />
          ))}
        </View>
      </NavigationPrimaryActionContext.Provider>
    );
  }
  const view = await render(<Fixture saving={false} />);
  expect(
    screen.getByTestId('provider-selection-confirmation-privacy'),
  ).toBeTruthy();
  expect(screen.getByText(/선택한 AI/)).toBeTruthy();
  expect(screen.queryByTestId('provider-selection-confirm')).toBeNull();
  expect(screen.queryByTestId('provider-selection-cancel')).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-cancel-provider-selection'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  await view.rerender(<Fixture saving />);
  expect(screen.getByTestId('dock-confirm-provider')).toBeDisabled();
  expect(screen.getByTestId('dock-cancel-provider-selection')).toBeDisabled();
});
