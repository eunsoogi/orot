import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { AppointmentReminderControls } from '../AppointmentReminderControls';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';

const originalWindow = Dimensions.get('window');

function direction(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('appointment-reminder-controls').props.style,
  )?.flexDirection;
}

it('reflows the reminder preview within its measured width and system text scale', async () => {
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const view = (panelWidth: number) => (
    <View style={{ padding: 16, width: panelWidth }}>
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderControls appointment={appointment} />
      </AppointmentReminderProvider>
    </View>
  );

  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } });
  let unmount: (() => void) | undefined;
  try {
    const rendered = await render(view(600));
    unmount = rendered.unmount;
    const controls = screen.getByTestId('appointment-reminder-controls');

    expect(direction()).toBe('column');
    await fireEvent(controls, 'layout', {
      nativeEvent: { layout: { width: 568, height: 240, x: 0, y: 0 } },
    });
    expect(direction()).toBe('row');
    expect(
      screen.getByText('잠금 화면에는 예약 내용 없이 준비 안내만 표시해요.'),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`appointment-reminder-${appointment.id}-60`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`appointment-reminder-${appointment.id}-1440`),
    ).toBeTruthy();

    await rendered.rerender(view(464));
    await fireEvent(
      screen.getByTestId('appointment-reminder-controls'),
      'layout',
      {
        nativeEvent: { layout: { width: 432, height: 300, x: 0, y: 0 } },
      },
    );
    expect(direction()).toBe('column');

    await act(async () => {
      Dimensions.set({ window: { ...originalWindow, fontScale: 1.5 } });
    });
    await rendered.rerender(view(600));
    await fireEvent(
      screen.getByTestId('appointment-reminder-controls'),
      'layout',
      {
        nativeEvent: { layout: { width: 568, height: 360, x: 0, y: 0 } },
      },
    );
    expect(direction()).toBe('column');
  } finally {
    unmount?.();
    Dimensions.set({ window: originalWindow });
  }
});
