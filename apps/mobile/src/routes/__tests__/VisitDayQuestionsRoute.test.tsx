import { AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import { savedOverviewQuestions } from '../../../test-helpers/overviewFixtures';
import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { VisitDayQuestionsRoute } from '../VisitDayQuestionsRoute';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
beforeEach(() => {
  AppState.currentState = 'active';
});
const appointment: Appointment = {
  id: 'visit',
  effectiveAt: '2035-06-02T00:00:00Z',
  recordedAt: '2026-10-20T09:00:00Z',
  ingestedAt: '2026-10-20T09:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  status: 'scheduled',
  clinicLabel: 'Synthetic clinic',
};
function fixture(
  load = jest.fn(async () =>
    savedOverviewQuestions('visit', ['Synthetic question']),
  ),
) {
  const runtime = {
    list: jest.fn(async () => [appointment]),
    overviewPreparationTargets: new Map([['route', 'visit']]),
  };
  const view = () => (
    <AppointmentReminderProvider runtime={runtime as never}>
      <VisitDayQuestionsRoute routeKey="route" loadSavedQuestions={load} />
    </AppointmentReminderProvider>
  );
  return { runtime, load, view };
}

test('reads the exact visit and refreshes safely after a source deletion', async () => {
  const f = fixture();
  await render(f.view());
  expect(await screen.findByText('Synthetic question')).toBeTruthy();
  expect(
    screen.getByTestId('visit-day-question-synthetic-0'),
  ).toHaveTextContent('Synthetic question');
  expect(f.load).toHaveBeenCalledWith('visit');
  f.load.mockResolvedValue(savedOverviewQuestions('visit'));
  await act(() => notifyLocalSourceDeleted());
  expect(screen.queryByText('Synthetic question')).toBeNull();
  expect(
    await screen.findByText(/이 진료에 저장한 질문이 아직 없어요/),
  ).toBeTruthy();
});

test('reports failures and retries without generating or changing records', async () => {
  const f = fixture(
    jest
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue(savedOverviewQuestions('visit')),
  );
  await render(f.view());
  await fireEvent.press(await screen.findByTestId('visit-day-questions-retry'));
  expect(
    await screen.findByText(/이 진료에 저장한 질문이 아직 없어요/),
  ).toBeTruthy();
  expect(f.load).toHaveBeenCalledTimes(2);
});

test('rejects a cancelled appointment while its question read was pending', async () => {
  let finish!: (value: ReturnType<typeof savedOverviewQuestions>) => void;
  const f = fixture(
    jest.fn(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    ),
  );
  await render(f.view());
  f.runtime.list.mockResolvedValue([{ ...appointment, status: 'cancelled' }]);
  await act(() =>
    finish(savedOverviewQuestions('visit', ['Late private question'])),
  );
  expect(await screen.findByTestId('visit-day-questions-retry')).toBeTruthy();
  expect(screen.queryByText('Late private question')).toBeNull();
});

test('does not display another appointment result or late unmounted content', async () => {
  const f = fixture(
    jest.fn(async () => savedOverviewQuestions('other', ['Wrong visit'])),
  );
  const rendered = await render(f.view());
  expect(await screen.findByTestId('visit-day-questions-retry')).toBeTruthy();
  expect(screen.queryByText('Wrong visit')).toBeNull();
  await rendered.unmount();
});

test('does not publish a late question result after the route is unmounted', async () => {
  let finish!: (value: ReturnType<typeof savedOverviewQuestions>) => void;
  const f = fixture(
    jest.fn(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    ),
  );
  const view = await render(f.view());
  await view.unmount();
  await act(() =>
    finish(savedOverviewQuestions('visit', ['Unmounted result'])),
  );
  expect(f.load).toHaveBeenCalledTimes(1);
});

test('never reads questions when the bound visit has been removed', async () => {
  const f = fixture();
  f.runtime.list.mockResolvedValue([]);
  await render(f.view());
  expect(await screen.findByTestId('visit-day-questions-retry')).toBeTruthy();
  expect(f.load).not.toHaveBeenCalled();
});
