import { act, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { PropsWithChildren } from 'react';
import { createRecordRepository } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/dailyReportOpSqliteQueueFixture';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  reportService,
} from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';
import * as snapshotProjection from '../../healthEvidence/healthContext/finishDailyReportSnapshot';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { loadRecentSourceMaterial } from '../recentSourceReader';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { RecentMaterialReadinessContext } from '../RecentMaterialReadinessContext';
import {
  holdRecentTestPage,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
// Avoid Jest's unsupported dynamic import; use the same real media reader on
// the exact protected connection used by the Daily Report and material route.
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(),
  readSelectedRecentRecording: jest.fn(),
}));

const record = 'records-recent-source-synthetic-0';
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('mounted Records waits only for the Daily transaction, not detached source hashing or the held model', async () => {
  const previous = AppState.currentState;
  AppState.currentState = 'active';
  let protectedData = true;
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...recentTestExecution,
    protectedDataAvailable: async () => protectedData,
  });
  const f = openOpSqliteFileQueue();
  const snapshot = holdRecentTestPage<void>();
  const releaseSnapshot = holdRecentTestPage<void>();
  const projectionEntered = holdRecentTestPage<void>();
  const releaseProjection = holdRecentTestPage<void>();
  const providerEntered = holdRecentTestPage<void>();
  const releaseProvider = holdRecentTestPage<void>();
  let blocked = false;
  let snapshotSettled = false;
  const database = guardedNativeDatabase({
    execute: f.database.execute,
    async transaction(operation) {
      let ownsSnapshot = false;
      await f.database.transaction(tx =>
        operation({
          ...tx,
          async execute(query, bindings) {
            if (!blocked && query.startsWith('SELECT mutations, deletions')) {
              blocked = ownsSnapshot = true;
              snapshot.resolve();
              await releaseSnapshot.promise;
            }
            return tx.execute(query, bindings);
          },
        }),
      );
      if (ownsSnapshot) snapshotSettled = true;
    },
  });
  const finish = snapshotProjection.finishDailyReportSnapshot;
  const finishRead = jest
    .spyOn(snapshotProjection, 'finishDailyReportSnapshot')
    .mockImplementationOnce(async (...args) => {
      expect(snapshotSettled).toBe(true);
      projectionEntered.resolve();
      await releaseProjection.promise;
      return finish(...args);
    });
  const props = { ...recentRouteProps(), documentImportService: undefined };
  jest
    .mocked(loadRecentSourceMaterial)
    .mockImplementation(async (before, options) =>
      (
        await readCommittedRecentSourcePage(
          database,
          before && { id: before.key, createdAt: before.createdAt },
          options?.signal,
          options?.canRetry,
        )
      ).map(row => ({ ...row, key: row.id })),
    );
  // Stable identical owner, no snapshot or route witness substituted.
  const lease = { database, isCurrent: () => true };
  const Owner = ({ children }: PropsWithChildren) => (
    <RecentMaterialReadinessContext.Provider value={lease}>
      {children}
    </RecentMaterialReadinessContext.Provider>
  );
  const model = reportProvider();
  const generate = model.generate.bind(model);
  jest.spyOn(model, 'generate').mockImplementationOnce(async input => {
    providerEntered.resolve();
    await releaseProvider.promise;
    return generate(input);
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  let ui: Awaited<ReturnType<typeof renderRecords>> | undefined;
  let daily: ReturnType<ReturnType<typeof reportService>> | undefined;
  try {
    await prepareReportDatabase(database);
    await createRecordRepository(database).put('source_record', {
      ...props.recordings[0]!,
      recordingDurationMs: 120,
    });
    await new SqlCipherAgentMemoryStorage(database).append({
      id: 'admitted-memory',
      text: 'Synthetic note',
      vector: new Float32Array([1]),
      tags: [],
      entities: [],
      importance: 0.5,
      createdAt: Date.parse('2026-11-24T01:00:00Z'),
      reinforcements: 0,
      meta: {
        memoryKey: 'admitted-memory',
        kind: 'preference',
        provenance: { sourceIds: [], reviewState: 'user_confirmed' },
      },
    });
    controller.push('settings-provider');
    ui = await renderRecords(controller, props, true, Owner);
    daily = reportService(database, model)(reportRequest());
    await Promise.race([
      snapshot.promise,
      daily.then(result => {
        throw new Error(
          'Daily ended before snapshot: ' + JSON.stringify(result),
        );
      }),
    ]);
    await act(async () => {
      await controller.requestBack();
      await turn();
      await turn();
    });
    expect(screen.queryByTestId(record)).toBeNull();
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
    expect(model.generate).not.toHaveBeenCalled();
    await act(async () => {
      releaseSnapshot.resolve();
      await Promise.race([
        projectionEntered.promise,
        providerEntered.promise.then(() => {
          throw new Error('Daily entered provider before detached projection.');
        }),
        daily!.then(result => {
          throw new Error(
            'Daily ended before projection: ' + JSON.stringify(result),
          );
        }),
      ]);
    });
    expect(await screen.findByTestId(record)).toBeTruthy();
    expect(model.generate).not.toHaveBeenCalled();
    await act(async () => {
      releaseProjection.resolve();
      await providerEntered.promise;
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
    await act(() => {
      controller.push('settings-provider');
    });
    expect(await screen.findByTestId('model-tab-voice')).toBeTruthy();
    await act(async () => {
      await controller.requestBack();
    });
    expect(await screen.findByTestId(record)).toBeTruthy();
    await act(() => {
      controller.push('settings-provider');
    });
    expect(await screen.findByTestId('model-tab-voice')).toBeTruthy();
    protectedData = false;
    await act(async () => {
      await controller.requestBack();
    });
    expect(
      await screen.findByTestId('records-recent-sources-retry'),
    ).toBeTruthy();
    expect(screen.queryByTestId(record)).toBeNull();
    expect(model.generate).toHaveBeenCalledTimes(1);
    releaseProvider.resolve();
    await daily;
  } finally {
    releaseSnapshot.resolve();
    releaseProjection.resolve();
    releaseProvider.resolve();
    await daily;
    finishRead.mockRestore();
    await ui?.unmount();
    await f.close();
    AppState.currentState = previous;
  }
});
