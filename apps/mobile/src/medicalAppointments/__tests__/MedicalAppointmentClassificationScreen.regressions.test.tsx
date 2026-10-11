import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { CalendarEvent } from '../../calendar/types';
import * as workflow from '../classificationWorkflow';
import {
  event,
  renderScreen,
  repository,
  result,
} from '../MedicalAppointmentClassificationScreenTestFixtures';

const importAction = () =>
  screen.getByRole('button', { name: '캘린더에서 진료 일정 가져오기' });
afterEach(() => jest.restoreAllMocks());

test('classifies every event before automatically saving only confirmed medical results', async () => {
  const events = ['의료 일정', '비의료 일정', '불확실 일정', '미분류 일정'].map(
    (title, index) => event(`event-${index}`, title, '2035-06-02'),
  );
  const appointments = repository();
  let finish!: (value: workflow.ClassificationRunResult) => void;
  const classify = jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockImplementation(async input => {
      input.onProgress?.({
        ...result(events.slice(0, 1)),
        status: 'partial',
        totalBatches: 2,
      });
      return new Promise(resolve => {
        finish = resolve;
      });
    });
  await renderScreen([events], appointments);
  await fireEvent.press(importAction());
  await waitFor(() => expect(classify).toHaveBeenCalled());
  expect(classify.mock.calls[0][0].events).toEqual(events);
  expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  expect(screen.queryByText('선택한 AI로 분류')).toBeNull();
  const classified = result(events, [
    'medical',
    'non_medical',
    'uncertain',
    undefined,
  ]);
  // A stale classification field cannot make an explicitly unclassified candidate eligible.
  await act(async () =>
    finish({
      ...classified,
      candidates: classified.candidates.map((candidate, index) =>
        index === 3
          ? { ...candidate, status: 'unclassified', classification: 'medical' }
          : candidate,
      ),
    }),
  );
  await waitFor(() =>
    expect(appointments.confirmCalendarEvent).toHaveBeenCalledTimes(1),
  );
  expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(events[0]);
  expect(screen.getByText('의료 일정')).toBeTruthy();
  for (const title of ['비의료 일정', '불확실 일정', '미분류 일정'])
    expect(screen.queryByText(title)).toBeNull();
  expect(
    screen.queryByTestId('medical-appointment-save-calendar-candidate-1'),
  ).toBeNull();
});

test('automatically saves both same-title recurring occurrences with their exact dates', async () => {
  const first = event('recurring-event', '치과 진료', '2035-06-02');
  const second = event('recurring-event', '치과 진료', '2035-06-03');
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockResolvedValue(result([first, second]));
  const appointments = repository();
  const { bridge } = await renderScreen([[first, second]], appointments);
  await fireEvent.press(importAction());
  await waitFor(() =>
    expect(appointments.confirmCalendarEvent).toHaveBeenCalledTimes(2),
  );
  expect(appointments.confirmCalendarEvent).toHaveBeenNthCalledWith(1, first);
  expect(appointments.confirmCalendarEvent).toHaveBeenNthCalledWith(2, second);
  expect(screen.getAllByText('치과 진료')).toHaveLength(2);
  expect(
    screen.getByText('2035년 6월 2일 09:00–10:00 · Asia/Seoul'),
  ).toBeTruthy();
  expect(
    screen.getByText('2035년 6월 3일 09:00–10:00 · Asia/Seoul'),
  ).toBeTruthy();
  expect(bridge.findEvent).toHaveBeenCalledWith(
    'recurring-event',
    second.calendarEventSnapshot.occurrenceDate,
    null,
  );
});

test('blocks another import while a medical save is pending and confirms success only afterward', async () => {
  const first = event('first', 'A 진료', '2035-06-02');
  const next = event('next', 'B 진료', '2035-06-03');
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const appointments = repository(() => pending);
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockResolvedValue(result([first]));
  const { bridge } = await renderScreen([[first], [next]], appointments);
  await fireEvent.press(importAction());
  await waitFor(() =>
    expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(first),
  );
  expect(importAction()).toBeDisabled();
  expect(importAction().props.accessibilityState.busy).toBe(true);
  expect(screen.queryByText('일정을 저장했습니다.')).toBeNull();
  await fireEvent.press(importAction());
  expect(bridge.requestAccessAndListUpcomingEvents).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('B 진료')).toBeNull();
  await act(async () => finish());
  await waitFor(() => expect(importAction()).not.toBeDisabled());
  expect(screen.getAllByText('일정을 저장했습니다.').length).toBeGreaterThan(0);
});

test('clears the previous event progress as soon as a new query starts', async () => {
  const first = event('first', '기존 진료', '2035-06-02');
  const next = event('next', '새 진료', '2035-06-03');
  const appointments = repository();
  jest
    .spyOn(workflow, 'classifyCalendarEvents')
    .mockImplementation(async input => result(input.events));
  const { bridge } = await renderScreen([[first], [next]], appointments);
  await fireEvent.press(importAction());
  await waitFor(() => expect(importAction()).not.toBeDisabled());
  expect(screen.getByText('일정 1건 · 분류 완료')).toBeTruthy();
  let finish!: (value: {
    access: 'fullAccess';
    events: CalendarEvent[];
  }) => void;
  jest.mocked(bridge.requestAccessAndListUpcomingEvents).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await fireEvent.press(importAction());
  expect(screen.queryByText('일정 1건 · 분류 완료')).toBeNull();
  expect(screen.queryByText('기존 진료')).toBeNull();
  await act(async () => finish({ access: 'fullAccess', events: [next] }));
  await waitFor(() =>
    expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(next),
  );
});
