import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { medicalAppointmentCopy as copy } from '../copy.ko';
import {
  event,
  renderScreen,
  repository,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

const importAction = () =>
  screen.getByRole('button', { name: '캘린더에서 진료 일정 가져오기' });

test.each(['allow', 'cancel'] as const)(
  'requires actual-request approval and keeps manual entry after %s',
  async decision => {
    const selected = selectedProvider();
    const remote = {
      ...selected,
      privacyBoundary: 'selected-context-remote' as const,
    };
    const appointments = repository();
    const { onOpenManual } = await renderScreen(
      [[event('private-calendar-id', '치과 진료', '2035-06-02')]],
      appointments,
      remote,
    );
    await fireEvent.press(importAction());
    expect(
      await screen.findByText('전송 전에 내용을 확인해 주세요'),
    ).toBeTruthy();
    expect(screen.getByText(/"title":"치과 진료"/)).toBeTruthy();
    expect(screen.queryByText(/private-calendar-id/)).toBeNull();
    expect(selected.provider.generate).not.toHaveBeenCalled();
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByTestId(`inference-disclosure-${decision}`),
    );
    await waitFor(() => expect(importAction()).not.toBeDisabled());
    expect(screen.getByText(copy.manualReview)).toBeTruthy();
    expect(selected.provider.generate).toHaveBeenCalledTimes(
      decision === 'allow' ? 1 : 0,
    );
    expect(
      screen.queryByTestId('medical-appointment-save-calendar-candidate-1'),
    ).toBeNull();
    expect(screen.queryByText('치과 진료')).toBeNull();
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
    expect(onOpenManual).toHaveBeenCalledTimes(1);
  },
  30000,
);

test('keeps manual entry when Calendar permission is denied without invoking AI or saving', async () => {
  const appointments = repository();
  const selected = selectedProvider();
  const { bridge, onOpenManual } = await renderScreen(
    [[]],
    appointments,
    selected,
  );
  jest
    .mocked(bridge.requestAccessAndListUpcomingEvents)
    .mockResolvedValue({ access: 'denied', events: [] });
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.permissionUnavailable)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
  expect(onOpenManual).toHaveBeenCalledTimes(1);
  expect(selected.provider.generate).not.toHaveBeenCalled();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(appointments.create).not.toHaveBeenCalled();
});

test('does not save unclassified events when no AI has been selected', async () => {
  const appointments = repository();
  const { onOpenManual } = await renderScreen(
    [[event('no-provider', '진료', '2035-06-02')]],
    appointments,
    null,
  );
  await fireEvent.press(importAction());
  expect(await screen.findByText(copy.noProvider)).toBeTruthy();
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(screen.queryByText('진료')).toBeNull();
  await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
  expect(onOpenManual).toHaveBeenCalledTimes(1);
});
