import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { createAppointmentStore } from '../../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../../appointmentReminders/AppointmentReminderContext';
import { createNavigationController } from '../../../navigation/navigationController';
import type { AppNavigationRoute } from '../../../routes/appNavigationRoute';
import { DailyReportFlowScreen } from '../DailyReportFlowScreen';
import {
  createDailyReportConversationIntentStore,
  dailyReportConversationIntentStore,
} from '../dailyReportConversationIntentStore';
import { restoreDailyReportConversation } from '../restoreDailyReportConversation';
import type { AiFeatureServices } from '../featureServices';

jest.mock('../dailyReportConversationIntentStore', () => ({
  ...jest.requireActual('../dailyReportConversationIntentStore'),
  dailyReportConversationIntentStore: { select: jest.fn() },
}));

test('the real conversation flow restores the explicitly selected day after restart', async () => {
  const appointmentStore = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => appointmentStore.repository,
  );
  const intent = {
    kind: 'daily-report' as const,
    entryKey: 'daily-conversation:sample-1',
    request: {
      localDate: '2023-11-15',
      timeZone: 'Asia/Seoul',
      requestedAt: '2023-11-15T03:00:00Z',
    },
  };
  let saved = { intent, active: true };
  const store = createDailyReportConversationIntentStore({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
  });
  jest
    .mocked(dailyReportConversationIntentStore.select)
    .mockImplementation(store.select);
  runtime.dailyConversationTargets.set('original', { intent });
  const start = jest.fn(
    (_identity: ReturnType<typeof createDailyReportIdentity>) => ({
      status: 'started' as const,
      cancel: jest.fn(),
      result: Promise.resolve({ status: 'failed' as const, code: 'cancelled' }),
    }),
  );
  const services = {
    dailyReport: {
      lookup: jest.fn(async () => ({ status: 'missing' as const })),
      preview: jest.fn(async () => ({ status: 'not_today' as const })),
      start,
      active: jest.fn(() => null),
      retain: jest.fn(() => () => {}),
    },
  } as unknown as AiFeatureServices;
  const route = (key: string) => (
    <AppointmentReminderProvider runtime={runtime}>
      <DailyReportFlowScreen
        services={services}
        routeKey={key}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
        onOpenSource={jest.fn()}
        fallback={null}
      />
    </AppointmentReminderProvider>
  );
  const view = await render(route('original'));
  await screen.findByText('오늘 선택하기');
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  await screen.findByText('오늘 요약하기');
  await fireEvent.press(screen.getByText('오늘 요약하기'));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  const selected = start.mock.calls[0][0];
  await view.unmount();
  runtime.dailyConversationTargets.clear();
  const controller = createNavigationController<AppNavigationRoute>('root');
  expect(
    await restoreDailyReportConversation({
      controller,
      runtime,
      store,
      confirm: async () => 'approved',
    }),
  ).toBe('done');
  const resumed = await render(
    route(controller.getSnapshot().currentRoute.key),
  );
  await screen.findByText(`${selected.localDate} · ${selected.timeZone}`);
  expect(start).toHaveBeenCalledTimes(1);
  await resumed.unmount();
});
