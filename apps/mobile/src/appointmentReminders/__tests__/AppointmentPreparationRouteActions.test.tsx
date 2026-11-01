import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { AppointmentReminderProvider } from '../AppointmentReminderContext';
import { AppointmentPreparationRoute } from '../AppointmentPreparationRoute';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));

test('retries the same preparation target without opening another visit', async () => {
  const list = jest.fn(async () => []);
  const runtime = {
    list,
    targets: new Map(),
    homePreparationTargets: new Map(),
  };
  const load = jest.fn();
  function Fixture() {
    const { host, actions } = useNavigationPrimaryActionHost('preparation');
    return (
      <AppointmentReminderProvider runtime={runtime as never}>
        <NavigationPrimaryActionContext.Provider value={host}>
          <AppointmentPreparationRoute
            routeKey="missing-visit"
            loadSavedQuestions={load}
          />
          <View>
            {actions.map(action => (
              <Button
                key={action.id}
                title={action.label}
                testID={`dock-${action.id}`}
                onPress={() => {
                  action.onPress();
                }}
              />
            ))}
          </View>
        </NavigationPrimaryActionContext.Provider>
      </AppointmentReminderProvider>
    );
  }
  await render(<Fixture />);
  await screen.findByTestId('dock-retry-appointment-preparation');
  await fireEvent.press(
    screen.getByTestId('dock-retry-appointment-preparation'),
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(load).not.toHaveBeenCalled();
});
