import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appColors } from '../../layout/appColors';
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

function choiceDirection(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('appointment-reminder-actions').props.style,
  )?.flexDirection;
}

function actionCellMinWidth(minutes: 60 | 1440): number | undefined {
  const action = screen.getByTestId(
    `appointment-reminder-${appointment.id}-${minutes}`,
  );
  return StyleSheet.flatten(action.parent?.props.style)?.minWidth;
}

it('caps scaled action cells at the measured row width when space is insufficient', async () => {
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );

  Dimensions.set({ window: { ...originalWindow, fontScale: 3 } });
  let unmount: (() => void) | undefined;
  try {
    const rendered = await render(
      <View style={{ padding: 16, width: 282 }}>
        <AppointmentReminderProvider runtime={runtime}>
          <AppointmentReminderControls appointment={appointment} />
        </AppointmentReminderProvider>
      </View>,
    );
    unmount = rendered.unmount;

    const actionRow = screen.getByTestId('appointment-reminder-actions');
    await fireEvent(actionRow, 'layout', {
      nativeEvent: { layout: { width: 250, height: 200, x: 0, y: 0 } },
    });

    expect(actionCellMinWidth(60)).toBe(250);
    expect(actionCellMinWidth(1440)).toBe(250);
  } finally {
    unmount?.();
    Dimensions.set({ window: originalWindow });
  }
});

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
    const actionRow = screen.getByTestId('appointment-reminder-actions');

    expect(direction()).toBe('column');
    expect(choiceDirection()).toBe('row');
    expect(actionCellMinWidth(60)).toBe(44);
    await fireEvent(actionRow, 'layout', {
      nativeEvent: { layout: { width: 568, height: 44, x: 0, y: 0 } },
    });
    expect(actionCellMinWidth(60)).toBe(92);
    expect(actionCellMinWidth(1440)).toBe(92);
    expect(screen.getByTestId('appointment-reminder-title')).toHaveTextContent(
      '진료 준비 알림',
    );
    await fireEvent(controls, 'layout', {
      nativeEvent: { layout: { width: 568, height: 240, x: 0, y: 0 } },
    });
    expect(direction()).toBe('row');
    expect(choiceDirection()).toBe('row');
    expect(
      screen.getByText('잠금 화면에는 예약 내용 없이 준비 안내만 표시해요.'),
    ).toBeTruthy();
    for (const id of [60, 1440]) {
      const button = screen.getByTestId(
        `appointment-reminder-${appointment.id}-${id}`,
      );
      expect(button.props.accessibilityRole).toBe('button');
      expect(StyleSheet.flatten(button.props.style)).toMatchObject({
        backgroundColor: appColors.surface,
        borderColor: appColors.border,
        borderWidth: 1,
        borderRadius: 12,
        minHeight: 44,
        minWidth: 44,
      });
    }

    await rendered.rerender(view(464));
    await fireEvent(
      screen.getByTestId('appointment-reminder-controls'),
      'layout',
      {
        nativeEvent: { layout: { width: 432, height: 300, x: 0, y: 0 } },
      },
    );
    await fireEvent(actionRow, 'layout', {
      nativeEvent: { layout: { width: 432, height: 44, x: 0, y: 0 } },
    });
    expect(direction()).toBe('column');
    expect(choiceDirection()).toBe('row');
    expect(actionCellMinWidth(60)).toBe(92);
    expect(actionCellMinWidth(1440)).toBe(92);

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
    await fireEvent(actionRow, 'layout', {
      nativeEvent: { layout: { width: 432, height: 44, x: 0, y: 0 } },
    });
    expect(direction()).toBe('column');
    expect(choiceDirection()).toBe('row');
    expect(actionCellMinWidth(60)).toBe(138);
    expect(actionCellMinWidth(1440)).toBe(138);
  } finally {
    unmount?.();
    Dimensions.set({ window: originalWindow });
  }
});
