import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appColors } from '../../layout/appColors';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { AppointmentReminderControls } from '../AppointmentReminderControls';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { observeReminderActions } from '../reminderActionObservation';

/** The UI still invokes exactly the original select and consumes its rejected promise. */
it.each([false, true])(
  'preserves select arguments and error consumption with observer throwing=%s',
  async throwing => {
    const store = createAppointmentStore([appointment]);
    const runtime = createAppointmentReminderRuntime(
      async () => store.repository,
    );
    const sentinel = new Error('Synthetic selection rejection');
    const select = jest
      .spyOn(runtime.coordinator, 'select')
      .mockRejectedValue(sentinel);
    const stop = throwing
      ? observeReminderActions(() => {
          throw new Error('Synthetic observer failure');
        })
      : () => {};
    try {
      await render(
        <AppointmentReminderProvider runtime={runtime}>
          <AppointmentReminderControls appointment={appointment} />
        </AppointmentReminderProvider>,
      );
      await fireEvent.press(
        screen.getByTestId(`appointment-reminder-${appointment.id}-60`),
      );
      await act(async () => {});
      expect(select).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledWith({
        appointmentId: appointment.id,
        leadMinutes: 60,
      });
    } finally {
      stop();
      select.mockRestore();
    }
  },
);

it('announces the selected lead time and keeps opt-out outside the action row', async () => {
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const snapshot = {
    selection: { appointmentId: appointment.id, leadMinutes: 60 },
    status: 'scheduled',
    busy: false,
  } as const;
  jest.spyOn(runtime.coordinator, 'getSnapshot').mockReturnValue(snapshot);

  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderControls appointment={appointment} />
    </AppointmentReminderProvider>,
  );

  const actionRow = screen.getByTestId('appointment-reminder-actions');
  const actions = within(actionRow);
  const oneHour = actions.getByTestId(
    `appointment-reminder-${appointment.id}-60`,
  );
  const oneDay = actions.getByTestId(
    `appointment-reminder-${appointment.id}-1440`,
  );
  expect(oneHour.props.accessibilityState).toMatchObject({
    selected: true,
    disabled: false,
  });
  expect(oneDay.props.accessibilityState).toMatchObject({
    selected: false,
    disabled: false,
  });
  expect(StyleSheet.flatten(oneHour.props.style)).toMatchObject({
    backgroundColor: appColors.primaryAction,
  });
  expect(screen.getByText('알림이 설정되었어요.')).toBeTruthy();
  expect(
    screen.getByTestId(`appointment-reminder-off-${appointment.id}`),
  ).toBeTruthy();
  expect(
    actions.queryByTestId(`appointment-reminder-off-${appointment.id}`),
  ).toBeNull();
});

it('keeps reminder and opt-out controls disabled while an update is pending', async () => {
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const snapshot = {
    selection: { appointmentId: appointment.id, leadMinutes: 60 },
    status: 'scheduled',
    busy: true,
  } as const;
  jest.spyOn(runtime.coordinator, 'getSnapshot').mockReturnValue(snapshot);

  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderControls appointment={appointment} />
    </AppointmentReminderProvider>,
  );

  const pendingActionIDs = [
    `appointment-reminder-${appointment.id}-60`,
    `appointment-reminder-${appointment.id}-1440`,
    `appointment-reminder-off-${appointment.id}`,
  ];
  for (const id of pendingActionIDs) {
    const action = screen.getByTestId(id);
    expect(action.props.accessibilityState).toMatchObject({
      busy: false,
      disabled: true,
    });
  }
});

it.each([
  ['denied', '알림 권한이 없어요. 설정에서 Orot 알림을 허용해 주세요.'],
  ['error', '알림을 갱신하지 못했어요. 다시 설정하거나 꺼 주세요.'],
] as const)(
  'keeps the %s reminder failure visible beside the choices',
  async (status, message) => {
    const store = createAppointmentStore([appointment]);
    const runtime = createAppointmentReminderRuntime(
      async () => store.repository,
    );
    const snapshot = {
      selection:
        status === 'denied'
          ? null
          : { appointmentId: appointment.id, leadMinutes: 60 as const },
      status,
      busy: false,
    } as const;
    jest.spyOn(runtime.coordinator, 'getSnapshot').mockReturnValue(snapshot);

    await render(
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderControls appointment={appointment} />
      </AppointmentReminderProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    const row = within(screen.getByTestId('appointment-reminder-actions'));
    expect(
      row.getByTestId(`appointment-reminder-${appointment.id}-60`),
    ).toBeTruthy();
    expect(
      row.getByTestId(`appointment-reminder-${appointment.id}-1440`),
    ).toBeTruthy();
  },
);
