import { HealthObservationSchema } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';

/** Synthetic data exercises the production SQLite, service, and provider adapter boundaries. */
export const reportObservation = HealthObservationSchema.parse({
  id: 'synthetic-report-source',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});

export function reportProvider(response = '{"indexes":[0]}') {
  return new InMemoryFakeLanguageModelProvider({
    capabilities: { streaming: false },
    response: { text: response, toolCalls: [], finishReason: 'complete' },
  });
}

export function selectedReportProvider(
  model: ReturnType<typeof reportProvider>,
  remoteProcessing = false,
): SelectedAiResolution {
  return {
    status: 'ready',
    provider: model,
    modelId: 'synthetic',
    recipient: 'synthetic recipient',
    remoteProcessing,
    selection: { providerId: model.id, modelId: 'synthetic' },
    option: {
      provider: model,
      modelId: 'synthetic',
      displayName: 'synthetic',
      privacyBoundary: remoteProcessing
        ? 'selected-context-remote'
        : 'on-device',
      availability: { status: 'available' },
    },
  };
}

export function reportService(
  database: SqlDatabase,
  model: ReturnType<typeof reportProvider>,
  options: {
    remoteProcessing?: boolean;
    authorize?: () => Promise<'authorized' | 'renewal_required'>;
  } = {},
) {
  return createDailyReportService({
    database,
    now: () => '2035-01-01T12:00:00Z',
    createRunId: () => 'synthetic-run',
    resolveSelected: async () =>
      selectedReportProvider(model, options.remoteProcessing),
    consent: { authorize: options.authorize ?? (async () => 'authorized') },
  });
}

export async function prepareReportDatabase(database: SqlDatabase) {
  await runMigrations(database);
  await createRecordRepository(database).put(
    'health_observation',
    reportObservation,
  );
}

export function reportRequest(signal = new AbortController().signal) {
  return {
    timeZone: 'UTC',
    scope: {},
    mode: { kind: 'reuse_or_generate' as const },
    signal,
  };
}

/** Fails one SQL statement while keeping all surrounding operations on real SQLite. */
export function failTransactionQuery(
  database: SqlDatabase,
  matches: (query: string) => boolean,
  detail: string,
): SqlDatabase {
  return {
    execute: (query, parameters) => database.execute(query, parameters),
    transaction: operation =>
      database.transaction(tx =>
        operation({
          ...tx,
          async execute(query, parameters) {
            if (matches(query)) throw new Error(detail);
            return tx.execute(query, parameters);
          },
        }),
      ),
  };
}
