import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../ragConversation/ConversationSessionsContext';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { todayIdentity } from '../../aiFeatures/integration/dailyReportTodayIdentity';
import type { AiFeatureServices } from '../../aiFeatures/integration/featureServices';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';
import type { SavedDailyReminderEntry } from '../dailyReminderDestination';
import { claimDailyReminderPrompt } from '../dailyReminderPromptReceipt';
import {
  acknowledgeDailyReminderTarget,
  consumeDailyReminderTarget,
} from '../nativeReminderBridge';
import { useDailyReminderPrompt } from '../useDailyReminderPrompt';

jest.mock('../nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => {}),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  consumeDailyReminderTarget: jest.fn(),
  acknowledgeDailyReminderTarget: jest.fn(),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));
jest.mock('../dailyReminderIntentStore', () => ({
  dailyReminderIntentStore: { read: jest.fn(), write: jest.fn() },
}));
jest.mock('../dailyReminderPromptReceipt');

test('a live daily tap delayed by real leave ownership invokes the canonical choice once for its delivered day', async () => {
  const appState = AppState.currentState;
  AppState.currentState = 'active';
  const controller = createNavigationController<AppNavigationRoute>('root');
  const rootKey = controller.getSnapshot().currentRoute.key;
  const delivered = new Date(Date.now() - 5).toISOString();
  const deliveryTimestamp = String(Date.parse(delivered) / 1000);
  const inbox = [
    { kind: 'daily_report', deliveryTimestamp },
    { kind: 'daily_report', deliveryTimestamp },
  ];
  const sender = jest.fn().mockResolvedValue({ status: 'no_evidence' });
  const dailyReport = {} as NonNullable<AiFeatureServices['dailyReport']>;
  let release!: (value: boolean) => void;
  let durable: SavedDailyReminderEntry | null = null;
  controller.registerLeaveGuard(
    rootKey,
    jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          }),
      )
      .mockResolvedValue(true),
  );
  const transitioning = controller.requestTabSwitch();
  jest
    .mocked(consumeDailyReminderTarget)
    .mockImplementation(async () => inbox[0] ?? null);
  jest.mocked(acknowledgeDailyReminderTarget).mockImplementation(async () => {
    inbox.shift();
  });
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockImplementation(async () => durable);
  jest
    .mocked(dailyReminderIntentStore.write)
    .mockImplementation(async value => {
      durable = value;
    });
  jest.mocked(claimDailyReminderPrompt).mockResolvedValue(true);
  const runtime = createAppointmentReminderRuntime(
    async () => createAppointmentStore([]).repository,
  );
  function CanonicalConversation() {
    const store = useConversationSessions();
    const choice = useDailyReminderPrompt({
      canonical: true,
      rootKey,
      store,
      isVisible: () => controller.getSnapshot().currentRoute.key === rootKey,
      services: { dailyReport, sendRagMessage: sender },
    });
    return (
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={sender}
        onOpenDailyReport={choice}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider>
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderDeliveryHost
          controller={controller}
          openConversationRoot={key => controller.commitApprovedRoot(key)}
          promptAllowed={() => true}
          capturePromptRoot={() => () => true}
        />
      </AppointmentReminderProvider>
      <CanonicalConversation />
    </ConversationSessionsProvider>,
  );
  try {
    await waitFor(() =>
      expect(dailyReminderIntentStore.write).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
      ),
    );
    expect(sender).not.toHaveBeenCalled();
    expect(claimDailyReminderPrompt).not.toHaveBeenCalled();
    await act(async () => {
      release(true);
      await transitioning;
    });
    await waitFor(() =>
      expect(acknowledgeDailyReminderTarget).toHaveBeenCalledTimes(2),
    );
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]).toBe('일일 보고서');
    expect(sender.mock.calls[0]?.[3]?.inputOrigin).toBe('shortcut');
    expect(sender.mock.calls[0]?.[4]).toMatchObject({
      intent: 'daily-report',
      reportRequest: todayIdentity(),
    });
    expect(claimDailyReminderPrompt).toHaveBeenCalledTimes(1);
    expect(claimDailyReminderPrompt).toHaveBeenCalledWith(delivered);
    expect(controller.getSnapshot().routes).toHaveLength(1);
    const manual = await screen.findByTestId('daily-report-request');
    expect(manual).toBeEnabled();
    await fireEvent.press(manual);
    await waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
    expect(sender.mock.calls[1]?.[4]).toEqual(sender.mock.calls[0]?.[4]);
  } finally {
    await view.unmount();
    AppState.currentState = appState;
  }
});
