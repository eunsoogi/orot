import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { SavedSummaryHistory } from '../SavedSummaryHistory';

test('retries saving once and restores the exact saved result through the dock', async () => {
  const result = { hypotheses: [] };
  const history = {
    list: jest.fn(async () => []),
    read: jest.fn(async () => null),
    retrySave: jest.fn(async () => result),
  };
  const restore = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('summary');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <SavedSummaryHistory
          history={history}
          current={{ status: 'failed' }}
          disabled={false}
          expanded={false}
          onRestore={restore}
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
  await render(<Fixture />);
  expect(
    screen.getByText('요약을 기기에 저장하지 못했어요. 다시 저장해 주세요.'),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('symptom-summary-history')).queryByRole(
      'button',
      { name: '다시 저장' },
    ),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('dock-retry-summary-save'));
  expect(history.retrySave).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledWith(result);
});
