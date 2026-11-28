import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { createConversationSessions } from '../../ragConversation/conversationSessions';

const mockStore = createConversationSessions();
jest.mock('../../ragConversation/ConversationSessionsContext', () => ({
  useConversationSessions: () => mockStore,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../OverviewPreparedVisits', () => ({
  OverviewPreparedVisits: () => null,
}));
jest.mock('../overview/OverviewMetrics', () => ({
  OverviewMetrics: () => null,
}));

test('the real Overview root has no daily report entry and still opens its guarded visit questions route', async () => {
  const selectTab = jest.fn();
  const push = jest.fn(() => ({
    name: 'visit-day-questions',
    key: 'day-route',
  }));
  const runtime = { overviewPreparationTargets: new Map() };
  const id = mockStore.getSnapshot().activeId;
  mockStore.setDraft(id, 'Existing synthetic conversation draft');
  const before = mockStore.getSnapshot();
  await render(
    <AppointmentReminderProvider runtime={runtime as never}>
      <AppRouteContent
        {...({
          actions: { route: { key: 'root', name: 'root' }, push },
          activeTab: 'overview',
          selectTab,
          recordings: [],
          appointmentState: 'ready',
          nextAppointment: {
            id: 'synthetic-visit',
            effectiveAt: '2035-06-02T00:00:00Z',
            recordedAt: '2026-10-20T09:00:00Z',
            ingestedAt: '2026-10-20T09:00:00Z',
            provenance: { origin: 'user_reported', sourceRecordIds: [] },
            reviewState: { status: 'unreviewed' },
            status: 'scheduled',
            clinicLabel: '합성 의원',
          },
        } as unknown as AppRouteContentProps)}
      />
    </AppointmentReminderProvider>,
  );
  expect(screen.getByTestId('overview-screen')).toBeTruthy();
  expect(screen.queryByTestId('overview-open-daily-report')).toBeNull();
  expect(screen.queryByRole('button', { name: '일일 보고서' })).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: '준비한 진료 질문' }),
  );
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith('visit-day-questions');
  expect(runtime.overviewPreparationTargets.get('day-route')).toBe(
    'synthetic-visit',
  );
  expect(selectTab).not.toHaveBeenCalled();
  expect(mockStore.getSnapshot()).toBe(before);
});
