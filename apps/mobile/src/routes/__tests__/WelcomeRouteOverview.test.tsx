import { fireEvent, render, screen } from '@testing-library/react-native';
import { savedHomeQuestions } from '../../../test-helpers/homeOverviewFixtures';
import { savedSource } from '../../recording/recordingScreenSupport';
import WelcomeRoute, { type WelcomeRouteProps } from '../WelcomeRoute';
import { formatDate, t } from '../../i18n';
import { StyleSheet } from 'react-native';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';

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

test('keeps one home end gutter beyond the navigation overlap', async () => {
  await render(
    <NavigationOcclusionContext.Provider
      value={{
        placement: 'bottom',
        systemInsets: { top: 0, right: 0, bottom: 34, left: 0 },
        viewportInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        scrollContentInsets: { top: 0, right: 0, bottom: 52, left: 0 },
      }}
    >
      <NavigationRouteScrollView>
        <WelcomeRoute {...props()} />
      </NavigationRouteScrollView>
    </NavigationOcclusionContext.Provider>,
  );
  const scroll = StyleSheet.flatten(
    screen.getByTestId('navigation-route-scroll').props.contentContainerStyle,
  );
  const page = StyleSheet.flatten(
    screen.getByTestId('home-screen').props.style,
  );
  expect(scroll.paddingBottom + page.paddingBottom).toBe(84);
});

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

test('keeps Home preparation explicit and compact within the filled visit card', async () => {
  const input = props();
  await render(<WelcomeRoute {...input} />);

  const action = screen.getByTestId('home-prepare-visit');
  expect(action.props.accessibilityRole).toBe('button');
  expect(action.props.accessibilityLabel).toBe('진료 준비하기');
  expect(StyleSheet.flatten(action.props.style)).toMatchObject({
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  });

  await fireEvent.press(action);
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

test('keeps the confirmed visit and preparation visible during a refresh and failure', async () => {
  const input = props();
  const route = await render(<WelcomeRoute {...input} />);
  expect(await screen.findByText('저장한 질문 1개')).toBeTruthy();

  await route.rerender(<WelcomeRoute {...input} appointmentState="loading" />);
  expect(screen.getByTestId('home-appointment-loading')).toBeTruthy();
  expect(screen.getByTestId('home-next-appointment-clinic')).toBeTruthy();
  expect(screen.getByText('저장한 질문 1개')).toBeTruthy();

  await route.rerender(<WelcomeRoute {...input} appointmentState="failed" />);
  expect(screen.getByTestId('home-next-appointment-clinic')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home-appointments-retry'));
  expect(input.onRetryAppointments).toHaveBeenCalledTimes(1);
});
