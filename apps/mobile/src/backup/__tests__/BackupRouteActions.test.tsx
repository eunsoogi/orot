import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import BackupStatusRecovery from '../BackupStatusRecovery';

test('moves backup preparation while keeping checking state disabled', async () => {
  const retry = jest.fn(async () => undefined);
  function Fixture({ checking }: { checking: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('backup');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <BackupStatusRecovery
          state={checking ? 'checking' : 'recoveryRequired'}
          onRetry={retry}
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
  const view = await render(<Fixture checking />);
  expect(screen.getByTestId('dock-prepare-backup')).toBeDisabled();
  await view.rerender(<Fixture checking={false} />);
  await fireEvent.press(screen.getByTestId('dock-prepare-backup'));
  expect(retry).toHaveBeenCalledTimes(1);
});
