import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { AppState, type AppStateStatus } from 'react-native';
import type { PropsWithChildren } from 'react';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import type { RecentMaterialReadyLease } from '../../generatedReports/certifiedRecentMaterialPage';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { RecentMaterialReadinessContext } from '../RecentMaterialReadinessContext';
import type { LoadRecentPage } from '../recentSavedMaterialPageTypes';
import {
  loadRecentSourceMaterial,
  type RecentMediaRow,
} from '../recentSourceReader';
import {
  holdRecentTestPage,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';
import {
  expectRetainedPaint,
  fixture,
} from '../testSupport/recentRecordsRetainedPaintTestSupport';
jest.mock('../RecordsSnapshotSurface');
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(async () => []),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(),
  readSelectedRecentRecording: jest.fn(),
}));

const { mediaId, memoryId, file, memory, error, retry } = fixture;

test.each([
  'Voice Model Back',
  'native foreground',
  'inactive compact',
  'inactive app default',
  'inactive app default without warm receipt',
  'background app default',
  'inactive full',
  'background full',
] as const)(
  'a warm mixed Records preview returns without a transient Retry: %s',
  async journey => {
    const oldAppState = AppState.currentState;
    AppState.currentState = 'active';
    const listeners = new Set<(value: AppStateStatus) => void>();
    const appState = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((name, listener) => {
        if (name === 'change') listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      });
    const phase = (value: AppStateStatus) => {
      AppState.currentState = value;
      for (const listener of [...listeners]) listener(value);
    };
    const db = openInterleavableRecentSourceDatabase();
    const database = guardedNativeDatabase<SqlDatabase>({
      execute: (sql, binds) => db.database.execute(sql, binds),
      transaction: task => db.database.transaction(task),
    });
    const entered = holdRecentTestPage<void>();
    const resume = holdRecentTestPage<void>();
    let readAgain = false;
    let grants = 0;
    const lease: RecentMaterialReadyLease = { database, isCurrent: () => true };
    const proof = jest.fn(async () => {
      grants++;
      return AppState.currentState === 'active';
    });
    jest.mocked(conversationExecutionNative).mockReturnValue({
      ...recentTestExecution,
      currentPhase: () =>
        AppState.currentState === 'active' ? 'active' : 'background',
      protectedDataAvailable: proof,
    });
    function Readiness({ children }: PropsWithChildren) {
      return (
        <RecentMaterialReadinessContext.Provider value={lease}>
          {children}
        </RecentMaterialReadinessContext.Provider>
      );
    }
    try {
      await runMigrations(database);
      await createRecordRepository(database).put('source_record', {
        id: mediaId,
        sourceKind: 'medical_document',
        ingestedAt: '2026-11-24T02:00:00Z',
        title: file,
        provenance: { origin: 'imported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
      });
      await new SqlCipherAgentMemoryStorage(database).append({
        id: memoryId,
        text: 'Synthetic unexposed Memory body',
        vector: new Float32Array([1]),
        tags: [],
        entities: [],
        importance: 0.5,
        createdAt: Date.parse('2026-11-24T01:00:00Z'),
        reinforcements: 0,
        meta: {
          memoryKey: memoryId,
          kind: 'preference',
          provenance: { sourceIds: [], reviewState: 'user_confirmed' },
        },
      });
      const defaultRoute = journey.includes('app default');
      jest
        .mocked(loadRecentSourceMaterial)
        .mockImplementation(async (before, supplied) => {
          const options = supplied as Parameters<
            LoadRecentPage<RecentMediaRow>
          >[1];
          if (readAgain) {
            readAgain = false;
            entered.resolve();
            await resume.promise;
          }
          const rows = await readCommittedRecentSourcePage(
            database,
            before && { id: before.key, createdAt: before.createdAt },
            options?.signal,
            options?.canRetry,
            journey === 'inactive app default' &&
              options?.settledOwner &&
              options.registerSettled
              ? {
                  owner: options.settledOwner,
                  onSettled: options.registerSettled,
                }
              : undefined,
          );
          return rows.map(row => ({ ...row, key: row.id }));
        });
      const controller = createNavigationController<AppNavigationRoute>('root');
      const view = await renderRecords(
        controller,
        { ...recentRouteProps(), documentImportService: undefined },
        defaultRoute ? 'app-default' : true,
        Readiness,
      );
      try {
        const full = journey.endsWith(' full');
        if (full)
          await fireEvent.press(
            await screen.findByTestId('records-recent-view-all'),
          );
        expect(await screen.findByText(file)).toBeTruthy();
        expect(await screen.findByTestId(memory)).toBeTruthy();
        const paintedFile = screen.getByText(file);
        const warmGrants = grants;
        if (journey === 'Voice Model Back') {
          await act(async () => {
            controller.push('settings-provider');
          });
          await fireEvent.press(await screen.findByTestId('model-tab-voice'));
          expect(
            await screen.findByTestId('voice-model-group-openai-api'),
          ).toBeTruthy();
          expect(controller.getSnapshot().currentRoute.name).toBe(
            'settings-provider',
          );
        } else {
          await act(async () =>
            phase(journey.startsWith('inactive') ? 'inactive' : 'background'),
          );
          expect(
            screen.queryByTestId('records-recent-sources-loading'),
          ).toBeNull();
          expect(screen.queryByText(file)).toBeNull();
          expect(screen.queryByTestId(memory)).toBeNull();
          if (defaultRoute) {
            expect(
              screen.getByText(file, { includeHiddenElements: true }),
            ).toBe(paintedFile);
            expectRetainedPaint();
            expect(grants).toBe(warmGrants);
          }
        }
        readAgain = true;
        await act(async () => {
          if (journey === 'Voice Model Back') await controller.requestBack();
          else phase('active');
        });
        await entered.promise;
        expect(controller.getSnapshot().currentRoute.name).toBe(
          full ? 'recent-records' : 'root',
        );
        if (defaultRoute) {
          await waitFor(() => {
            expect(
              screen.getByText(file, { includeHiddenElements: true }),
            ).toBe(paintedFile);
            expect(
              screen.getByTestId(memory, { includeHiddenElements: true }),
            ).toBeTruthy();
          });
          const retained = expectRetainedPaint();
          expect(retained.props.accessibilityElementsHidden).toBe(true);
        } else if (journey !== 'Voice Model Back') {
          expect(screen.queryByText(file)).toBeNull();
        }
        expect(screen.queryByTestId(error)).toBeNull();
        expect(screen.queryByTestId(retry)).toBeNull();
        expect(grants).toBeGreaterThan(warmGrants);
        await act(async () => resume.resolve());
        await waitFor(() => {
          expect(screen.getByText(file)).toBeTruthy();
          expect(screen.getByTestId(memory)).toBeTruthy();
        });
        expect(screen.queryByTestId(retry)).toBeNull();
        expect(
          screen.queryByText('Synthetic unexposed Memory body'),
        ).toBeNull();
      } finally {
        resume.resolve();
        await view.unmount();
      }
    } finally {
      appState.mockRestore();
      AppState.currentState = oldAppState;
      db.close();
    }
  },
  20_000,
);
