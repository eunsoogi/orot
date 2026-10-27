import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
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
