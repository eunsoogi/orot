import type { LanguageModelExecutionOptions } from '@orot/model-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  reportService,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { createHealthSummaryService } from '../healthSummaryService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

jest.mock('../visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(async () => ({ id: 'synthetic-appointment' })),
    generate: jest.fn(),
  },
}));

/** Hold final output so a receipt cannot accidentally be proven by completion. */
function processingProvider() {
  const provider = reportProvider();
  let acknowledge!: () => void;
  let finish!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => {
    entered = resolve;
  });
  jest
    .spyOn(provider, 'generate')
    .mockResolvedValue(
      providerSuccess({
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete',
      }),
    )
    .mockImplementationOnce(
      async (_request, options?: LanguageModelExecutionOptions) => {
        acknowledge = () => options?.onResponseStarted?.();
        entered();
        await new Promise<void>(resolve => {
          finish = resolve;
        });
        return providerSuccess({
          text: '{"indexes":[0]}',
          toolCalls: [],
          finishReason: 'complete',
        });
      },
    );
  return {
    provider,
    ready,
    acknowledge: () => acknowledge(),
    finish: () => finish(),
  };
}

test('visit turn forwards the original receipt through its selected option before output', async () => {
  const f = processingProvider();
  const onProviderReceipt = jest.fn();
  jest
    .mocked(defaultVisitQuestionRouteOperations.generate)
    .mockImplementation(async input => {
      expect(input.selectedAi.provider).toBe(input.selectedAi.option.provider);
      await input.selectedAi.option.provider.generate(
        { messages: [] } as never,
        { signal: input.signal },
      );
      return { status: 'cancelled' };
    });
  const turn = createConversationVisitTurn({
    loadLocalData: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    registerSource: jest.fn() as never,
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: 'synthetic-appointment',
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
  });
  const work = turn({
    question: 'Synthetic visit request',
    signal: new AbortController().signal,
    resolveSelectedAi: async () => selectedReportProvider(f.provider),
    confirmConsent: async () => true,
    observer: { onProviderReceipt },
  });
  await f.ready;
  expect(onProviderReceipt).not.toHaveBeenCalled();
  f.acknowledge();
  expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
  f.finish();
  await work;
  expect(onProviderReceipt).toHaveBeenCalledTimes(1);
});

test('summary service preserves processing callback before its final model result', async () => {
  const f = processingProvider();
  const onProviderReceipt = jest.fn();
  const service = createHealthSummaryService({
    selectedAi: async () => selectedReportProvider(f.provider) as never,
    loadData: async () => ({
      ...localData([]).data,
      readHealthContext: jest.fn(),
    }),
    registry: new LocalEvidenceReferenceRegistry(),
    consent: { authorize: async () => 'authorized' },
    createRunId: () => 'synthetic-summary',
    runner: (async options => {
      await options.provider.generate({ messages: [] } as never);
      return { status: 'failure' } as never;
    }) as typeof runDiseaseHypothesisAnalysis,
  });
  const work = service(
    { question: 'Synthetic summary request' },
    new AbortController().signal,
    { onProviderReceipt },
  );
  await f.ready;
  expect(onProviderReceipt).not.toHaveBeenCalled();
  f.acknowledge();
  expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
  f.finish();
  await work;
});

test('real report service observes processing after consent and before output', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await prepareReportDatabase(db.database);
    const f = processingProvider();
    const onProviderReceipt = jest.fn();
    const authorize = jest.fn(async () => 'authorized' as const);
    const work = reportService(db.database, f.provider, {
      remoteProcessing: true,
      authorize,
    })({ ...reportRequest(), observer: { onProviderReceipt } });
    await f.ready;
    expect(authorize).toHaveBeenCalled();
    expect(onProviderReceipt).not.toHaveBeenCalled();
    f.acknowledge();
    expect(onProviderReceipt).toHaveBeenCalledWith('response_started');
    f.finish();
    await work;
    expect(onProviderReceipt).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});

test('refused report consent never invokes provider or records read', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await prepareReportDatabase(db.database);
    const f = processingProvider();
    const onProviderReceipt = jest.fn();
    await reportService(db.database, f.provider, {
      remoteProcessing: true,
      authorize: async () => 'renewal_required',
    })({ ...reportRequest(), observer: { onProviderReceipt } });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(onProviderReceipt).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
