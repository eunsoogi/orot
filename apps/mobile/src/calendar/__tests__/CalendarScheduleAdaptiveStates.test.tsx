import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import {
  bridge,
  repository,
  syncedCalendar,
} from '../calendarLinkingTestFixtures';

it('keeps calendar loading and retryable errors visible in adaptive Schedule', async () => {
  let rejectInitialLoad!: (error: Error) => void;
  let loadCount = 0;
  const initialLoad = new Promise<never[]>((_resolve, reject) => {
    rejectInitialLoad = reject;
  });
  const appointments = repository(() => {
    loadCount += 1;
    return loadCount === 1 ? initialLoad : Promise.resolve([]);
  });

  // A pending read exposes loading state without adding a delay to the test.
  await render(
    <CalendarLinkingScreen
      adaptiveScheduleLayout
      repository={appointments}
      bridge={bridge()}
      calendarSync={syncedCalendar([])}
    />,
  );
  expect(screen.getByTestId('schedule-adaptive-columns-primary')).toBeTruthy();
  expect(screen.getByTestId('calendar-storage-loading')).toBeTruthy();

  await act(async () => rejectInitialLoad(new Error('storage unavailable')));
  expect(await screen.findByTestId('calendar-error')).toHaveTextContent(
    '예약을 불러오지 못했어요. 다시 시도해 주세요.',
  );
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => {
    expect(appointments.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('calendar-storage-loading')).toBeNull();
    expect(screen.queryByTestId('calendar-error')).toBeNull();
  });
});
