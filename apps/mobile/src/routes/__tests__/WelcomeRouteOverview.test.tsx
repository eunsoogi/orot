import { fireEvent, render, screen } from '@testing-library/react-native';
import { savedHomeQuestions } from '../../../test-helpers/homeOverviewFixtures';
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
    loadSavedVisitQuestions: async id =>
      savedHomeQuestions(id, ['진료 전 확인할 합성 질문']),
    onRetryAppointments: jest.fn(),
    onRetryRecordings: jest.fn(),
    onPrepareVisit: jest.fn(),
    onOpenSchedule: jest.fn(),
    onOpenRecords: jest.fn(),
    onOpenRecording: jest.fn(),
    ...overrides,
  };
}

test('shows saved questions without a symptom journal shortcut', async () => {
  const input = props();
  await render(<WelcomeRoute {...input} />);
  expect(
    screen.getByText(
      `${formatDate(new Date())} · ${t('home.localTimeZone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
    ),
  ).toBeTruthy();
  expect(await screen.findByText('저장한 질문 1개')).toBeTruthy();
  expect(screen.queryByTestId('home-ongoing-symptoms')).toBeNull();
  expect(screen.queryByTestId('home-recent-records-panel')).toBeNull();
  expect(screen.queryByTestId('home-new-recording')).toBeNull();
  await fireEvent.press(screen.getByTestId('home-prepare-visit'));
  expect(screen.queryByTestId('home-open-symptoms')).toBeNull();
  expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
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
