import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportRoute } from '../DailyReportRoute';
import { createDailyReminderDestination } from '../../../appointmentReminders/dailyReminderDestination';
import { createDailyReportConversationIntentStore } from '../dailyReportConversationIntentStore';
import { parseDailyReminderEntry } from '../../../appointmentReminders/dailyReminderDelivery';
import type { createDailyReportFeature } from '../dailyReportFeature';

test.each(['reminder', 'conversation'] as const)(
  '%s selection persists before generation and restores the selected day',
  async kind => {
    const old = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
    const entry = parseDailyReminderEntry(
      { kind: 'daily_report', deliveryTimestamp: '1700000000' },
      'Asia/Seoul',
    )!;
    let reminder = { entry, active: true };
    let conversation = {
      intent: {
        kind: 'daily-report' as const,
        entryKey: 'daily-conversation:test-1',
        request: {
          localDate: old.localDate,
          timeZone: old.timeZone,
          requestedAt: '2023-11-15T03:00:00Z',
        },
      },
      active: true,
    };
    const reminderPort = {
      read: async () => reminder,
      write: async (value: typeof reminder) => {
        reminder = value;
      },
      open: jest.fn(async () => 'opened' as const),
    };
    const destination = createDailyReminderDestination(reminderPort);
    const store = createDailyReportConversationIntentStore({
      read: async () => conversation,
      write: async value => {
        conversation = value;
      },
    });
    const start = jest.fn(
      (_identity: ReturnType<typeof createDailyReportIdentity>) => ({
        status: 'started' as const,
        cancel: jest.fn(),
        result: Promise.resolve({
          status: 'failed' as const,
          code: 'cancelled',
        }),
      }),
    );
    const feature = {
      lookup: jest.fn(async () => ({ status: 'missing' as const })),
      preview: jest.fn(async () => ({ status: 'not_today' as const })),
      start,
      active: jest.fn(() => null),
      retain: jest.fn(() => () => {}),
    } as unknown as ReturnType<typeof createDailyReportFeature>;
    await render(
      <DailyReportRoute
        feature={feature}
        initialIdentity={old}
        reminder={kind === 'reminder'}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
        onSelectToday={async request => {
          if (kind === 'reminder')
            await destination.select(entry.entryKey, request);
          else await store.select(conversation.intent.entryKey, request);
        }}
      />,
    );
    await screen.findByText('오늘 선택하기');
    await fireEvent.press(screen.getByText('오늘 선택하기'));
    await screen.findByText('오늘 요약하기');
    await fireEvent.press(screen.getByText('오늘 요약하기'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const selected = start.mock.calls[0][0];
    if (kind === 'reminder') {
      const restored = createDailyReminderDestination(reminderPort);
      await restored.restore();
      expect(reminderPort.open).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedRequest: expect.objectContaining({
            localDate: selected.localDate,
            timeZone: selected.timeZone,
          }),
        }),
      );
    } else {
      expect((await store.read())?.intent.request).toEqual(
        expect.objectContaining({
          localDate: selected.localDate,
          timeZone: selected.timeZone,
        }),
      );
    }
  },
);

test('a failed durable selection leaves the old day and does not enable generation', async () => {
  const old = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const start = jest.fn();
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start,
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={old}
      reminder
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
      onSelectToday={async () => {
        throw new Error('locked');
      }}
    />,
  );
  await screen.findByText('오늘 선택하기');
  await fireEvent.press(screen.getByText('오늘 선택하기'));
  await screen.findByText(
    '선택한 날짜를 저장하지 못했어요. 다시 시도해 주세요.',
  );
  expect(screen.queryByText('오늘 요약하기')).toBeNull();
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByText('오늘 선택하기')).toBeTruthy();
});

test('equivalent route identities do not release an active generation on parent rerender', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const cancel = jest.fn();
  const retain = jest.fn(() => cancel);
  const feature = {
    lookup: jest.fn(async () => ({ status: 'missing' as const })),
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn(() => ({ cancel, result: new Promise(() => {}) })),
    retain,
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  const view = await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('보고서를 만들고 있어요.');
  const retained = retain.mock.calls.length;
  await view.rerender(
    <DailyReportRoute
      feature={feature}
      initialIdentity={createDailyReportIdentity(
        identity.localDate,
        identity.timeZone,
      )}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  expect(retain).toHaveBeenCalledTimes(retained);
  expect(cancel).not.toHaveBeenCalled();
});
