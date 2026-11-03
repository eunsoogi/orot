import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  activeHomeSymptom,
  homeJournal,
  savedHomeQuestions,
} from '../../../test-helpers/homeOverviewFixtures';
import { savedSource } from '../../recording/recordingScreenSupport';
import WelcomeRoute, { type WelcomeRouteProps } from '../WelcomeRoute';
import { formatDate, t } from '../../i18n';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

function props(overrides: Partial<WelcomeRouteProps> = {}): WelcomeRouteProps {
  return {
    appointment: {
      id: 'next-visit',
      effectiveAt: '2035-06-02T00:00:00Z',
      recordedAt: '2026-10-20T09:00:00Z',
      ingestedAt: '2026-10-20T09:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'scheduled',
      clinicLabel: '합성 의원',
    },
    appointmentState: 'ready',
    recentRecording: savedSource,
    recordingState: 'ready',
    loadSymptoms: async () => homeJournal(),
    loadSavedVisitQuestions: async id =>
      savedHomeQuestions(id, ['진료 전 확인할 합성 질문']),
    onRetryAppointments: jest.fn(),
    onRetryRecordings: jest.fn(),
    onPrepareVisit: jest.fn(),
    onOpenSchedule: jest.fn(),
    onOpenRecords: jest.fn(),
    onOpenSymptoms: jest.fn(),
    onOpenRecording: jest.fn(),
    ...overrides,
  };
}

test('shows the saved question count and active symptoms without duplicate shortcuts', async () => {
  const input = props();
  await render(<WelcomeRoute {...input} />);
  expect(
    screen.getByText(
      `${formatDate(new Date())} · ${t('home.localTimeZone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
    ),
  ).toBeTruthy();
  expect(await screen.findByText('저장한 질문 1개')).toBeTruthy();
  expect(await screen.findByText(/합성 손 저림/)).toBeTruthy();
  expect(screen.queryByTestId('home-recent-records-panel')).toBeNull();
  expect(screen.queryByTestId('home-new-recording')).toBeNull();
  for (const id of ['home-prepare-visit', 'home-open-symptoms']) {
    await fireEvent.press(screen.getByTestId(id));
  }
  expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
  expect(input.onOpenSymptoms).toHaveBeenCalledTimes(1);
});

test('shows true zero severity and an unknown update time for a legacy symptom', async () => {
  await render(
    <WelcomeRoute
      {...props({
        loadSymptoms: async () =>
          homeJournal([{ ...activeHomeSymptom, severity: 0 }]),
      })}
    />,
  );
  const symptom = await screen.findByTestId(
    'home-symptom-home-synthetic-symptom',
  );
  expect(symptom).toHaveTextContent(/강도 0\/10/);
  expect(symptom).toHaveTextContent(/갱신 시각 알 수 없음/);
  expect(symptom).toHaveTextContent(/시작/);
});

test('shows empty visit and symptom states without generic capture guidance', async () => {
  const input = props({
    appointment: null,
    recentRecording: null,
    loadSymptoms: async () => homeJournal([]),
  });
  await render(<WelcomeRoute {...input} />);
  expect(await screen.findByText('기록 중인 증상이 없어요.')).toBeTruthy();
  expect(screen.getByTestId('home-next-visit-panel')).toBeTruthy();
  expect(screen.queryByTestId('home-recent-records-panel')).toBeNull();
  await fireEvent.press(screen.getByTestId('home-open-symptoms'));
  expect(input.onOpenSymptoms).toHaveBeenCalledTimes(1);
});

test('shows unfinished preparation only after a successful empty read for a real visit', async () => {
  const loadSavedVisitQuestions = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue(savedHomeQuestions('next-visit'));
  await render(<WelcomeRoute {...props({ loadSavedVisitQuestions })} />);
  expect(await screen.findByTestId('home-questions-retry')).toBeTruthy();
  expect(screen.queryByTestId('home-preparation-pending')).toBeNull();
  expect(screen.queryByTestId('home-recent-recording')).toBeNull();
  await fireEvent.press(screen.getByTestId('home-questions-retry'));
  expect(await screen.findByTestId('home-preparation-pending')).toBeTruthy();
});

test('keeps recovery and capture available when symptom reads fail instead of claiming empty summaries', async () => {
  const loadSymptoms = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue(homeJournal());
  const input = props({
    appointment: null,
    recentRecording: null,
    loadSymptoms,
  });
  await render(<WelcomeRoute {...input} />);
  expect(await screen.findByTestId('home-symptoms-retry')).toBeTruthy();
  expect(screen.queryByTestId('home-capture-guidance')).toBeNull();
  await fireEvent.press(screen.getByTestId('home-open-schedule'));
  expect(input.onOpenSchedule).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('home-symptoms-retry'));
  expect(await screen.findByText(/합성 손 저림/)).toBeTruthy();
});

test('does not claim a first record when the journal already contains resolved history outside the active summary', async () => {
  const repository = homeJournal([
    {
      ...activeHomeSymptom,
      status: 'resolved',
      resolvedAt: '2026-10-21T09:00:00Z',
    },
  ]);
  expect(await repository.list()).toHaveLength(1);
  await render(
    <WelcomeRoute
      {...props({
        appointment: null,
        recentRecording: null,
        loadSymptoms: async () => repository,
      })}
    />,
  );
  expect(await screen.findByText('기록 중인 증상이 없어요.')).toBeTruthy();
  expect(screen.queryByTestId('home-capture-guidance')).toBeNull();
});
