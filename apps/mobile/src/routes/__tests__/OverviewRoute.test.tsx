import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { savedOverviewQuestions } from '../../../test-helpers/overviewFixtures';
import OverviewRoute, { type OverviewRouteProps } from '../OverviewRoute';
import { Dimensions, StyleSheet, View } from 'react-native';
import { appointmentTimeLabel } from '../nextAppointment';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { NavigationOcclusionContext } from '../../navigation/useNavigationContentInset';

jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(null),
  useIsFocused: () => true,
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../layout/AppSymbol', () => ({
  AppSymbol: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').View, {
      testID: `symbol-${name}`,
    }),
}));

function props(
  overrides: Partial<OverviewRouteProps> = {},
): OverviewRouteProps {
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
    loadSavedVisitQuestions: async id =>
      savedOverviewQuestions(id, ['진료 전 확인할 합성 질문']),
    onRetryAppointments: jest.fn(),
    onPrepareVisit: jest.fn(),
    onOpenSchedule: jest.fn(),
    onEditMetricSelection: jest.fn(),
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
        <OverviewRoute {...props()} />
      </NavigationRouteScrollView>
    </NavigationOcclusionContext.Provider>,
  );
  const scroll = StyleSheet.flatten(
    screen.getByTestId('navigation-route-scroll').props.contentContainerStyle,
  );
  const page = StyleSheet.flatten(
    screen.getByTestId('overview-screen').props.style,
  );
  expect(scroll.paddingBottom + page.paddingBottom).toBe(84);
});

test('shows saved questions without a symptom journal shortcut', async () => {
  const input = props();
  await render(<OverviewRoute {...input} />);
  expect(screen.getByText('준비한 진료 질문')).toBeTruthy();
  expect(screen.queryByText('저장한 질문 1개')).toBeNull();
  expect(screen.queryByTestId('home-ongoing-symptoms')).toBeNull();
  expect(screen.queryByTestId('overview-recent-records-panel')).toBeNull();
  expect(screen.queryByTestId('home-new-recording')).toBeNull();
  await fireEvent.press(screen.getByTestId('overview-prepare-visit'));
  expect(screen.queryByTestId('home-open-symptoms')).toBeNull();
  expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
});

test('keeps Home preparation explicit and compact in the cardless visit section', async () => {
  const input = props();
  await render(<OverviewRoute {...input} />);

  const action = screen.getByTestId('overview-prepare-visit');
  expect(within(action).getByTestId('symbol-chevron.right')).toBeTruthy();
  expect(action.props.accessibilityRole).toBe('button');
  expect(action.props.accessibilityLabel).toBe('준비한 진료 질문');
  expect(StyleSheet.flatten(action.props.style)).toMatchObject({
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    gap: 6,
  });

  await fireEvent.press(action);
  expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
});

test('does not eagerly read question text or counts on Overview', async () => {
  const loadSavedVisitQuestions = jest.fn();
  await render(<OverviewRoute {...props({ loadSavedVisitQuestions })} />);
  expect(loadSavedVisitQuestions).not.toHaveBeenCalled();
  expect(screen.queryByTestId('overview-preparation-pending')).toBeNull();
  expect(screen.getByText('준비한 진료 질문')).toBeTruthy();
});

test('keeps the confirmed visit and preparation visible during a refresh and failure', async () => {
  const input = props();
  const route = await render(<OverviewRoute {...input} />);
  expect(screen.getByText('준비한 진료 질문')).toBeTruthy();
  expect(screen.queryByText('저장한 질문 1개')).toBeNull();

  await route.rerender(<OverviewRoute {...input} appointmentState="loading" />);
  expect(screen.getByTestId('overview-appointment-loading')).toBeTruthy();
  expect(screen.getByTestId('overview-next-appointment-clinic')).toBeTruthy();
  expect(screen.getByText('준비한 진료 질문')).toBeTruthy();

  await route.rerender(<OverviewRoute {...input} appointmentState="failed" />);
  expect(screen.getByTestId('overview-next-appointment-clinic')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('overview-appointments-retry'));
  expect(input.onRetryAppointments).toHaveBeenCalledTimes(1);
});

// Mount the actual route at compact/large text and expanded widths; layout geometry is native-only.
test.each([
  { width: 320, fontScale: 2 },
  { width: 920, fontScale: 1 },
])(
  'keeps visit metadata and the action in the section at width $width',
  async ({ width, fontScale }) => {
    const initialWindow = Dimensions.get('window');
    const initialScreen = Dimensions.get('screen');
    const window = { ...initialWindow, width, fontScale };
    const input = props();
    if (!input.appointment) throw new Error('Missing synthetic visit');
    const appointment = {
      ...input.appointment,
      clinicLabel: '긴 이름도 모두 표시하는 합성 병원 외래 진료 예약',
    };
    try {
      await act(async () => Dimensions.set({ window, screen: window }));
      await render(
        <View style={{ width }}>
          <OverviewRoute {...input} appointment={appointment} />
        </View>,
      );
      const card = within(screen.getByTestId('overview-next-appointment'));
      expect(card.getByTestId('overview-next-visit-heading')).toHaveTextContent(
        '다음 진료',
      );
      const titleRow = card.getByTestId('overview-next-visit-title-row');
      expect(StyleSheet.flatten(titleRow.props.style).flexDirection).toBe(
        'row',
      );
      const title = within(titleRow);
      expect(
        title.getByTestId('overview-next-visit-countdown'),
      ).toHaveTextContent(/^D[-+]?[0-9]+$|^D-day$/);
      const clinic = title.getByTestId('overview-next-appointment-clinic');
      const timeRow = within(card.getByTestId('overview-next-visit-time-row'));
      expect(timeRow.getByTestId('symbol-calendar')).toBeTruthy();
      const time = timeRow.getByTestId('overview-next-visit-time');
      expect(
        StyleSheet.flatten(
          screen.getByTestId('overview-next-visit-panel').props.style,
        )?.backgroundColor,
      ).toBeUndefined();
      expect(clinic).toHaveTextContent(appointment.clinicLabel);
      expect(clinic.props.numberOfLines).toBeUndefined();
      expect(time).toHaveTextContent(appointmentTimeLabel(appointment));
      expect(time.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(clinic.props.style).fontSize).toBeGreaterThan(
        StyleSheet.flatten(time.props.style).fontSize,
      );
      expect(screen.queryByText(/ · 현지 시간 /)).toBeNull();
      const action = card.getByRole('button', { name: '준비한 진료 질문' });
      await fireEvent.press(action);
      expect(input.onPrepareVisit).toHaveBeenCalledTimes(1);
      expect(input.onOpenSchedule).not.toHaveBeenCalled();
    } finally {
      await act(async () =>
        Dimensions.set({ window: initialWindow, screen: initialScreen }),
      );
    }
  },
);

test('keeps the empty section actionable without stale visit metadata', async () => {
  const input = props({ appointment: null });
  await render(<OverviewRoute {...input} />);
  const card = within(screen.getByTestId('overview-next-visit-panel'));
  expect(card.getByText('다음 진료')).toBeVisible();
  expect(card.queryByTestId('overview-next-visit-countdown')).toBeNull();
  expect(card.queryByTestId('overview-next-visit-time')).toBeNull();
  expect(card.queryByTestId('overview-prepare-visit')).toBeNull();
  await fireEvent.press(card.getByTestId('overview-open-schedule'));
  expect(input.onOpenSchedule).toHaveBeenCalledTimes(1);
  expect(input.onPrepareVisit).not.toHaveBeenCalled();
});
