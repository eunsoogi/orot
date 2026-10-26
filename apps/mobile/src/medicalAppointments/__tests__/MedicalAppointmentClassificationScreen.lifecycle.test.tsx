import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { CalendarEvent } from '../../calendar/types';
import * as workflow from '../classificationWorkflow';
import { medicalAppointmentCopy as copy } from '../copy.ko';
import {
  calendarSyncState,
  event,
  renderScreen,
  repository,
  result,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

const importAction = () => screen.getByTestId('medical-appointment-import');
afterEach(() => jest.restoreAllMocks());

test.each(['medium', 'high', undefined] as const)(
  'does not import medical classification with %s uncertainty',
  async uncertainty => {
    const candidate = event('ambiguous', '불확실한 의료 일정', '2035-06-02');
    const classified = result([candidate]);
    jest.spyOn(workflow, 'classifyCalendarEvents').mockResolvedValue({
      ...classified,
      candidates: classified.candidates.map(value => ({
        ...value,
        uncertainty,
      })),
    });
    const appointments = repository();
    await renderScreen([[candidate]], appointments);
    await fireEvent.press(importAction());
    await waitFor(() => expect(importAction()).not.toBeDisabled());
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(screen.queryByText('불확실한 의료 일정')).toBeNull();
  },
);

test('does not request Calendar access when the synced snapshot is unavailable', async () => {
  const candidate = event('calendar-unavailable', '진료', '2035-06-02');
  const appointments = repository();
  const classify = jest.spyOn(workflow, 'classifyCalendarEvents');
  const { bridge, onOpenCalendarSettings } = await renderScreen(
    [[candidate]],
    appointments,
    undefined,
    calendarSyncState([], 'denied'),
  );
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.permissionUnavailable)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('medical-appointment-calendar-settings'),
  );
  expect(onOpenCalendarSettings).toHaveBeenCalledTimes(1);
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
  expect(classify).not.toHaveBeenCalled();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
});

test('aborts classification on unmount and ignores even a late medical result', async () => {
  const candidate = event('late-ai', '늦은 의료 분류', '2035-06-02');
  const appointments = repository();
  let finish!: (value: workflow.ClassificationRunResult) => void;
  const classify = jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  const { view } = await renderScreen([[candidate]], appointments);
  await fireEvent.press(importAction());
  await waitFor(() => expect(classify).toHaveBeenCalled());
  await view.unmount();
  expect(classify.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => finish(result([candidate])));
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
});

test('does not write after unmount during occurrence revalidation', async () => {
  const candidate = event('late-source', '재확인 중인 일정', '2035-06-02');
  const appointments = repository();
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockResolvedValue(result([candidate]));
  const { bridge, view } = await renderScreen([[candidate]], appointments);
  let finish!: (value: { access: 'fullAccess'; event: CalendarEvent }) => void;
  jest.mocked(bridge.findEvent).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await fireEvent.press(importAction());
  await waitFor(() => expect(bridge.findEvent).toHaveBeenCalled());
  await view.unmount();
  await act(async () => finish({ access: 'fullAccess', event: candidate }));
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
});

test('does not begin the next automatic save after leaving during the first write', async () => {
  const events = [
    event('first', '첫 진료', '2035-06-02'),
    event('second', '두 번째 진료', '2035-06-03'),
  ];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const appointments = repository(() => pending);
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockResolvedValue(result(events));
  const { view } = await renderScreen([events], appointments);
  await fireEvent.press(importAction());
  await waitFor(() =>
    expect(appointments.confirmCalendarEvent).toHaveBeenCalledTimes(1),
  );
  await view.unmount();
  await act(async () => finish());
  expect(appointments.confirmCalendarEvent).toHaveBeenCalledTimes(1);
});

test('does not save a medical event whose current snapshot changed', async () => {
  const candidate = event('changed', '변경 전 진료', '2035-06-02');
  const appointments = repository();
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockResolvedValue(result([candidate]));
  const { bridge } = await renderScreen([[candidate]], appointments);
  jest.mocked(bridge.findEvent).mockResolvedValue({
    access: 'fullAccess',
    event: {
      ...candidate,
      calendarEventSnapshot: {
        ...candidate.calendarEventSnapshot,
        title: '변경된 약속',
      },
    },
  });
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.stale)).toBeTruthy();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
});
