import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { HealthObservationSchema } from '@orot/domain';
import { createDailyReportIdentity } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createAppointmentStore } from '../../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../../appointmentReminders/AppointmentReminderContext';
import { parseDailyReminderEntry } from '../../../appointmentReminders/dailyReminderDelivery';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { DailyReportFlowScreen } from '../DailyReportFlowScreen';
import { DailyReportRoute } from '../DailyReportRoute';
import { createDailyReportRequests } from '../dailyReportRequests';
import { createDailyReportService } from '../dailyReportService';
import { previewDailyReport } from '../dailyReportPreview';
import { requestDailyReportFromConversation } from '../dailyReportConversationEntry';
import type { AiFeatureServices } from '../featureServices';
import type { SelectedAiResolution } from '../provider';

test('viewing app and reminder routes does not dispatch; explicit generation crosses the synthetic remote boundary once', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const instant = today.toISOString();
    await createRecordRepository(connection.database).put(
      'health_observation',
      HealthObservationSchema.parse({
        id: 'synthetic-heart-rate',
        effectiveAt: instant,
        recordedAt: instant,
        ingestedAt: instant,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      }),
    );
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: { streaming: false },
      response: {
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    // This transport is an in-memory observer; it never sends data to a network.
    const originalGenerate = provider.generate.bind(provider);
    const transport = jest.fn(originalGenerate);
    const model = jest
      .spyOn(provider, 'generate')
      .mockImplementation(request => transport(request));
    const selection: SelectedAiResolution = {
      status: 'ready',
      provider,
      modelId: 'synthetic',
      recipient: 'synthetic',
      remoteProcessing: true,
      selection: { providerId: provider.id, modelId: 'synthetic' },
      option: {
        provider,
        modelId: 'synthetic',
        displayName: 'synthetic',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
    };
    const authorize = jest.fn(async () => 'authorized' as const);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const identity = createDailyReportIdentity(localDay, zone);
    const service = createDailyReportService({
      database: connection.database,
      consent: { authorize },
      now: () => new Date().toISOString(),
      createRunId: () => 'synthetic-run',
      resolveSelected: async () => selection,
    });
    const requests = createDailyReportRequests({
      lookup: createDailyReportStorage(connection.database).lookup,
      currentIdentity: () => identity,
      run: (requested, mode, signal) =>
        service({ timeZone: requested.timeZone, scope: {}, mode, signal }),
    });
    // Compose the actual route, request coordinator, preview, service and SQLite store at their public ports.
    const feature = {
      ...requests,
      preview: (requested: typeof identity, signal: AbortSignal) =>
        previewDailyReport({
          identity: requested,
          signal,
          now: new Date().toISOString(),
          openDatabase: async () => connection.database,
        }),
    };
    const route = await render(
      <DailyReportRoute
        feature={feature}
        providerSelection={null}
        onBack={jest.fn()}
        onChat={jest.fn()}
      />,
    );
    await screen.findByText(/오늘 요약하기|다시 요약하기/);
    expect(model).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    await route.unmount();

    const store = createAppointmentStore([]);
    const runtime = createAppointmentReminderRuntime(
      async () => store.repository,
    );
    const entry = parseDailyReminderEntry({
      kind: 'daily_report',
      deliveryTimestamp: String(Date.now() / 1000),
    });
    if (!entry) throw new Error('Synthetic reminder date was unavailable');
    runtime.dailyReportTargets.set('reminder', entry);
    const services = { dailyReport: feature } as unknown as AiFeatureServices;
    const reminder = await render(
      <AppointmentReminderProvider runtime={runtime}>
        <DailyReportFlowScreen
          services={services}
          routeKey="reminder"
          providerSelection={null}
          onBack={jest.fn()}
          onChat={jest.fn()}
          onOpenSource={jest.fn()}
          fallback={null}
        />
      </AppointmentReminderProvider>,
    );
    await screen.findByText('오늘 요약하기');
    expect(model).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('오늘 요약하기'));
    await waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    await screen.findByText('다시 요약하기');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      transport.mock.invocationCallOrder[0],
    );
    expect(JSON.stringify(transport.mock.calls[0][0])).toContain('72');
    await reminder.unmount();

    const result = await requestDailyReportFromConversation({
      feature,
      runtime,
      navigate: () => ({ key: 'conversation-report' }),
      now: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isCurrent: () => true,
      store: { activate: async () => {}, dismiss: async () => {} },
    });
    expect(result).toBe('opened');
    expect(
      runtime.dailyConversationTargets.get('conversation-report')?.operation,
    ).toBeUndefined();
    expect(model).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(1);
    const conversation = await render(
      <AppointmentReminderProvider runtime={runtime}>
        <DailyReportFlowScreen
          services={services}
          routeKey="conversation-report"
          providerSelection={null}
          onBack={jest.fn()}
          onChat={jest.fn()}
          onOpenSource={jest.fn()}
          fallback={null}
        />
      </AppointmentReminderProvider>,
    );
    await screen.findByText('다시 요약하기');
    expect(model).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    await conversation.unmount();
  } finally {
    connection.close();
  }
});
