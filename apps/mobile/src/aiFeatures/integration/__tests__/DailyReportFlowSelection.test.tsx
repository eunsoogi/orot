import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createAppointmentStore } from '../../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../../appointmentReminders/AppointmentReminderContext';
import { createDailyReminderDestination } from '../../../appointmentReminders/dailyReminderDestination';
import { parseDailyReminderEntry } from '../../../appointmentReminders/dailyReminderDelivery';
import { DailyReportFlowScreen } from '../DailyReportFlowScreen';
import type { AiFeatureServices } from '../featureServices';
import { createDailyReportIdentity } from '@orot/domain';

test('the real reminder flow restores the explicitly selected day after a new route', async () => {
  const appointmentStore = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => appointmentStore.repository,
  );
  const entry = parseDailyReminderEntry(
    { kind: 'daily_report', deliveryTimestamp: '1700000000' },
    'Asia/Seoul',
  )!;
  let saved = { entry, active: true };
  let restored = entry;
  const destination = createDailyReminderDestination({
    read: async () => saved,
    write: async value => {
      saved = value;
    },
    open: async value => {
      restored = value;
      return 'opened' as const;
    },
  });
  runtime.dailyReportSelection.selectReminder = destination.select;
  runtime.dailyReportTargets.set('original', entry);
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
  runtime.dailyReportTargets.clear();
  await destination.restore();
  runtime.dailyReportTargets.set('restored', restored);
  const resumed = await render(route('restored'));
  await screen.findByText(`${selected.localDate} · ${selected.timeZone}`);
  expect(
    screen.queryByText(
      '알림을 확인한 시점의 시간대예요. 알림이 전달된 당시의 시간대는 확인할 수 없어요.',
    ),
  ).toBeNull();
  expect(start).toHaveBeenCalledTimes(1);
  await resumed.unmount();
});
