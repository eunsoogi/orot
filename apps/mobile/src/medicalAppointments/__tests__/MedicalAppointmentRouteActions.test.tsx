import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, View } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../../navigation/useNavigationPrimaryAction';
import { MedicalAppointmentReviewView } from '../MedicalAppointmentReviewView';

test('moves the existing calendar import and preserves its readiness guard', async () => {
  const onImport = jest.fn(async () => undefined);
  function Fixture({ ready }: { ready: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('medical');
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <MedicalAppointmentReviewView
          provider={null}
          providerUnavailable={false}
          providerReady={ready}
          loading={false}
          calendarLoading={false}
          calendarUnavailable={false}
          classifying={false}
          accessAvailable={false}
          queryComplete={false}
          message=""
          eventCount={0}
          candidates={[]}
          savingId={null}
          savedIds={new Set()}
          onImport={onImport}
          onOpenManual={jest.fn()}
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
  const view = await render(<Fixture ready={false} />);
  expect(screen.getByTestId('dock-import-medical-appointments')).toBeDisabled();
  expect(screen.queryByTestId('medical-appointment-import')).toBeNull();
  await view.rerender(<Fixture ready />);
  await fireEvent.press(screen.getByTestId('dock-import-medical-appointments'));
  expect(onImport).toHaveBeenCalledTimes(1);
});
