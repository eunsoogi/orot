import { render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import App from '../App';
import { AppointmentReminderDeliveryHost } from '../src/appointmentReminders/AppointmentReminderDeliveryHost';

const mockRetention = { activeLease: jest.fn() };
const mockLoadLocalData = jest.fn();
jest.mock(
  '../src/appointmentReminders/AppointmentReminderDeliveryHost',
  () => ({ AppointmentReminderDeliveryHost: jest.fn(() => null) }),
);
jest.mock('../src/appEntry/RootURLDeliveryHost', () => ({
  RootURLDeliveryHost: () => null,
}));
jest.mock('../src/appEntry/rootURLBridge', () => ({
  rootURLBridge: { peek: jest.fn(async () => null) },
}));
jest.mock('../src/replyNotifications/nativeReplyNotifications', () => ({
  nativeReplyNotifications: () => ({ consumeTarget: async () => null }),
}));
jest.mock('../src/replyNotifications/reconcileReplyPrivacy', () => ({
  reconcileReplyPrivacy: () => () => {},
}));
jest.mock('../src/transcription/useRecapRecovery', () => ({
  useRecapRecovery: () => {},
}));
jest.mock('../src/calendar/useCalendarAutoSync', () => ({
  useCalendarAutoSync: () => ({}),
}));
jest.mock('../src/routes/useAppHomeData', () => ({
  useAppHomeData: () => ({}),
}));
jest.mock('../src/routes/useHomeActivity', () => ({
  useHomeActivity: () => ({}),
}));
jest.mock('../src/backup/useBackupPreparation', () => ({
  useBackupPreparation: () => ({ state: {}, retry: jest.fn() }),
}));
jest.mock(
  '../src/aiFeatures/integration/AiFeatureSharedNavigationState',
  () => ({
    AiFeatureSharedNavigationStateProvider: ({
      children,
    }: {
      children: React.ReactNode;
    }) => children,
  }),
);
jest.mock('../src/routes/AppAiFeatureScene', () => ({
  AppAiFeatureScene: () => null,
  isAppAiRoute: () => false,
  useAppAiServices: () => ({
    consent: {},
    disclosureSheet: null,
    services: {
      conversationSessionOptions: () => ({ retention: mockRetention }),
      loadSavedVisitQuestions: jest.fn(),
    },
  }),
}));
jest.mock('../src/navigation', () => ({
  ...jest.requireActual('../src/navigation'),
  NavigationRouteAdapter: () => null,
}));

test('the production app forwards reply dependencies and a live shared gate to its host', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  await render(
    <App aiFeatureServiceDependencies={{ loadLocalData: mockLoadLocalData }} />,
  );
  const host = jest.mocked(AppointmentReminderDeliveryHost);
  await waitFor(() => expect(host).toHaveBeenCalled());
  const props = host.mock.calls.at(-1)![0];
  expect(props.retention).toBe(mockRetention);
  expect(props.loadLocalData).toBe(mockLoadLocalData);
  expect(props.canEnterReply?.()).toBe(false);
  expect(await props.canRestoreEntry?.()).toBe(true);
  const wake = jest.fn();
  const unsubscribe = props.subscribeReplyEntryReady?.(wake);
  const key = props.controller.getSnapshot().currentRoute.key;
  props.controller.setLeaveStateAvailability(key, false);
  props.controller.registerLeaveGuard(key, async () => true);
  await Promise.resolve();
  expect(wake).not.toHaveBeenCalled();
  props.controller.setLeaveStateAvailability(key, true);
  await waitFor(() => expect(wake).toHaveBeenCalledTimes(1));
  unsubscribe?.();
  await props.executeReplyEntry?.(async () => {
    expect(props.canEnterReply?.()).toBe(true);
    props.onReplyOpened?.();
  });
  expect(props.canEnterReply?.()).toBe(false);
  expect(await props.canRestoreEntry?.()).toBe(false);
});
