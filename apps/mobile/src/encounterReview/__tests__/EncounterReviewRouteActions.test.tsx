import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { EncounterReviewActions } from '../EncounterReviewActions';

test('keeps selected-batch approval disabled and exposes distinct deny and running cancel', async () => {
  const save = jest.fn();
  const deny = jest.fn();
  const cancel = jest.fn();
  function Fixture({ running }: { running: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('review');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <EncounterReviewActions
          status={running ? 'running' : 'pending'}
          hasPending={!running}
          disabled={false}
          saveDisabled
          onStart={jest.fn()}
          onSave={save}
          onDeny={deny}
          onRestore={jest.fn()}
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
  const view = await render(<Fixture running={false} />);
  expect(screen.getByTestId('dock-save-encounter')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('dock-deny-encounter'));
  expect(deny).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await view.rerender(<Fixture running />);
  await fireEvent.press(screen.getByTestId('dock-cancel-encounter'));
  expect(cancel).toHaveBeenCalledTimes(1);
});
