import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import App from '../App';
import { defaultVisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import {
  homeJournal,
  savedHomeQuestions,
} from '../test-helpers/homeOverviewFixtures';

const mockLoadQuestions = jest.fn(async (id: string) =>
  savedHomeQuestions(id, ['예약별 합성 질문: ' + id]),
);
jest.mock('../src/aiFeatures/integration/featureServices', () => {
  const actual = jest.requireActual(
    '../src/aiFeatures/integration/featureServices',
  );
  return {
    ...actual,
    createAiFeatureServices: (...args: unknown[]) => ({
      ...actual.createAiFeatureServices(...args),
      loadSavedVisitQuestions: mockLoadQuestions,
    }),
  };
});

test('a visit canceled after Home loads never falls back to another future Calendar visit', async () => {
  const shown = appointment('취소할 표시 예약', 60_000);
  const other = appointment('다른 미래 Calendar 예약', 3_600_000, true);
  const store = createAppointmentStore([shown, other]);
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      loadSymptoms={async () => homeJournal([])}
    />,
  );
  expect(await screen.findByTestId('home-prepare-visit')).toBeTruthy();
  await store.repository.cancel(shown.id);
  mockLoadQuestions.mockClear();
  await fireEvent.press(screen.getByTestId('home-prepare-visit'));
  const destination = await screen.findByTestId('appointment-preparation');
  expect(await within(destination).findByRole('alert')).toBeTruthy();
  expect(within(destination).queryByText(other.clinicLabel!)).toBeNull();
  expect(mockLoadQuestions).not.toHaveBeenCalled();
});
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function appointment(
  id: string,
  offset: number,
  calendar = false,
  endsAfter?: number,
): Appointment {
  const now = Date.now();
  return {
    id,
    effectiveAt: new Date(now + offset).toISOString(),
    ...(endsAfter === undefined
      ? {}
      : { endsAt: new Date(now + endsAfter).toISOString() }),
    recordedAt: new Date(now).toISOString(),
    ingestedAt: new Date(now).toISOString(),
    status: 'scheduled',
    clinicLabel: id,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    ...(calendar
      ? {
          calendarEventIdentifier: 'event-' + id,
          calendarEventSnapshot: {
            title: id,
            timeZoneIdentifier: 'Asia/Seoul',
            isAllDay: false,
            occurrenceDate: null,
            isDetached: false,
            recurrenceRules: [],
          },
        }
      : {}),
  };
}

/** Use the production App controller and destination, rather than only observing a button callback. */
test.each(['manual', 'ongoing-calendar'] as const)(
  'opens preparation for the displayed %s visit even when another future Calendar visit exists',
  async kind => {
    const shown =
      kind === 'manual'
        ? appointment('표시한 수동 예약', 60_000)
        : appointment('표시한 진행 중 예약', -60_000, true, 120_000);
    const other = appointment('다른 미래 Calendar 예약', 3_600_000, true);
    const store = createAppointmentStore([other, shown]);
    mockLoadQuestions.mockClear();
    await render(
      <App
        loadAppointments={async () => store.repository}
        loadRecordings={async () => []}
        loadSymptoms={async () => homeJournal([])}
      />,
    );
    expect(
      within(await screen.findByTestId('home-next-appointment')).getByText(
        shown.clinicLabel!,
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-prepare-visit'));
    const destination = await screen.findByTestId('appointment-preparation');
    expect(
      await within(destination).findByText(shown.clinicLabel!),
    ).toBeTruthy();
    expect(
      within(destination).getByText('예약별 합성 질문: ' + shown.id),
    ).toBeTruthy();
    expect(within(destination).queryByText(other.clinicLabel!)).toBeNull();
    expect(mockLoadQuestions).not.toHaveBeenCalledWith(other.id);
    expect(
      within(destination).getByTestId('home-preparation-unsupported'),
    ).toHaveTextContent(/AI 질문 생성은 지원하지/);
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(
      within(await screen.findByTestId('home-next-appointment')).getByText(
        shown.clinicLabel!,
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-prepare-visit'));
    await fireEvent.press(
      await screen.findByTestId('home-preparation-open-schedule'),
    );
    expect(await screen.findByTestId('calendar-screen')).toBeTruthy();
    expect(
      screen.getByTestId('navigation-tab-schedule').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  },
);

test('a valid future Calendar visit still reaches the actual editable generation route', async () => {
  const shown = appointment('생성할 Calendar 예약', 3_600_000, true);
  const store = createAppointmentStore([shown]);
  const option = createAppleSelectionOption('available');
  const query = jest
    .spyOn(defaultVisitQuestionRouteOperations, 'loadAppointment')
    .mockResolvedValue(shown);
  try {
    await render(
      <App
        loadAppointments={async () => store.repository}
        loadRecordings={async () => []}
        loadSymptoms={async () => homeJournal([])}
        aiFeatureServiceDependencies={{
          selectedAi: {
            selectionStore: {
              load: async () => ({
                providerId: option.provider.id,
                modelId: option.modelId,
              }),
              save: async () => {},
              clear: async () => {},
            },
            loadAppleOption: async () => option,
          },
        }}
      />,
    );
    await fireEvent.press(await screen.findByTestId('home-prepare-visit'));
    expect(
      await screen.findByTestId('next-visit-questions-route'),
    ).toBeTruthy();
    expect(await screen.findByTestId('next-visit-generate')).toBeEnabled();
    expect(query).toHaveBeenCalled();
  } finally {
    query.mockRestore();
  }
});
