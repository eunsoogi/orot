import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  activeHomeSymptom,
  homeJournal,
  savedHomeQuestions,
} from '../../../test-helpers/homeOverviewFixtures';
import { savedSource } from '../../recording/recordingScreenSupport';
import WelcomeRoute, { type WelcomeRouteProps } from '../WelcomeRoute';

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

test('orders real preparation, active symptoms, recent recording and capture, preserving their actions', async () => {
  const input = props();
  await render(<WelcomeRoute {...input} />);
  expect(await screen.findByText('진료 전 확인할 합성 질문')).toBeTruthy();
  expect(await screen.findByText('합성 손 저림')).toBeTruthy();
  expect(
    screen
      .getAllByTestId(
        /^home-(next-visit-panel|ongoing-symptoms|recent-records-panel|new-recording)$/,
      )
      .map(node => node.props.testID),
  ).toEqual([
    'home-next-visit-panel',
    'home-ongoing-symptoms',
    'home-recent-records-panel',
    'home-new-recording',
  ]);
  for (const id of [
    'home-prepare-visit',
    'home-open-symptoms',
    'home-recent-recording',
    'home-new-recording',
  ]) {
    await fireEvent.press(screen.getByTestId(id));
  }
  expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
  expect(input.onOpenSymptoms).toHaveBeenCalledTimes(1);
  expect(input.onOpenRecords).toHaveBeenCalledTimes(1);
  expect(input.onOpenRecording).toHaveBeenCalledTimes(1);
});

test('guides an empty Home to two real capture actions without stacking empty cards', async () => {
  const input = props({
    appointment: null,
    recentRecording: null,
    loadSymptoms: async () => homeJournal([]),
  });
  await render(<WelcomeRoute {...input} />);
  expect(await screen.findByTestId('home-capture-guidance')).toBeTruthy();
  expect(screen.queryByTestId('home-next-visit-panel')).toBeNull();
  expect(screen.queryByTestId('home-recent-records-panel')).toBeNull();
  expect(screen.queryByTestId('home-ongoing-symptoms')).toBeNull();
  await fireEvent.press(screen.getByTestId('home-new-recording'));
  await fireEvent.press(screen.getByTestId('home-capture-symptom'));
  expect(input.onOpenRecording).toHaveBeenCalledTimes(1);
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
  expect(screen.getByTestId('home-recent-recording')).toBeTruthy();
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
  await fireEvent.press(screen.getByTestId('home-new-recording'));
  await fireEvent.press(screen.getByTestId('home-open-schedule'));
  expect(input.onOpenRecording).toHaveBeenCalledTimes(1);
  expect(input.onOpenSchedule).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('home-symptoms-retry'));
  expect(await screen.findByText('합성 손 저림')).toBeTruthy();
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
  const guidance = await screen.findByTestId('home-capture-guidance');
  expect(guidance).not.toHaveTextContent(/첫 기록/);
  expect(screen.getByTestId('home-new-recording')).toBeTruthy();
});
