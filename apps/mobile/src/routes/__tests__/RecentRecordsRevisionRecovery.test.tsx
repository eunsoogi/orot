import { act, screen } from '@testing-library/react-native';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import type { PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RecentMaterialReadyLease } from '../../generatedReports/certifiedRecentMaterialPage';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { RecentMaterialReadinessContext } from '../RecentMaterialReadinessContext';
import {
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
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(async () => []),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(async () => []),
  readSelectedRecentRecording: jest.fn(),
}));

test.each([
  ['settings Back', 1, 2],
  ['ordinary foreground', 1, 2],
  ['first open before publication', 5, 1],
] as const)(
  'reopens a fresh protected snapshot: %s',
  async (journey, stamp, writeCount) => {
    AppState.currentState = 'active';
    jest
      .mocked(conversationExecutionNative)
      .mockReturnValue(recentTestExecution);
    const callbacks = new Set<(state: AppStateStatus) => void>();
    const appState = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'change') callbacks.add(listener);
        return { remove: () => callbacks.delete(listener) };
      });
    function phase(state: AppStateStatus) {
      AppState.currentState = state;
      for (const listener of callbacks) listener(state);
    }
    const f = openInterleavableRecentSourceDatabase();
    let armed = false;
    let samples = 0;
    let conflicts = 0;
    const database = guardedNativeDatabase<SqlDatabase>({
      execute: (sql, binds) => f.database.execute(sql, binds),
      transaction: run =>
        f.database.transaction(tx =>
          run({
            ...tx,
            async execute(sql, binds) {
              const result = await tx.execute(sql, binds);
              if (
                armed &&
                sql.startsWith('SELECT total_changes() AS local') &&
                ++samples === stamp
              ) {
                conflicts++;
                samples = 0;
                armed = conflicts < writeCount;
                // An ordinary guarded write crosses the read witness without
                // changing the eligible row, protected owner, or permission.
                await database.execute('UPDATE lifecycle_fixture SET used = 1');
              }
              return result;
            },
          }),
        ),
    });
    const memory = new SqlCipherAgentMemoryStorage(database);
    const id = 'synthetic-current-memory';
    const row = 'records-recent-source-memory:agent:' + id;
    const lease: RecentMaterialReadyLease = {
      database,
      isCurrent: () => true,
    };
    function Ownership({ children }: PropsWithChildren) {
      return (
        <RecentMaterialReadinessContext.Provider value={lease}>
          {children}
        </RecentMaterialReadinessContext.Provider>
      );
    }
    try {
      await runMigrations(database);
      await database.execute('CREATE TABLE lifecycle_fixture (used INTEGER)');
      await database.execute('INSERT INTO lifecycle_fixture VALUES (0)');
      await memory.append({
        id,
        text: 'Synthetic private Memory text',
        vector: new Float32Array([1]),
        tags: [],
        entities: [],
        importance: 0.5,
        createdAt: Date.parse('2026-11-24T01:00:00Z'),
        reinforcements: 0,
        meta: {
          memoryKey: id,
          kind: 'preference',
          provenance: { sourceIds: [], reviewState: 'user_confirmed' },
        },
      });
      const controller = createNavigationController<AppNavigationRoute>('root');
      armed = journey === 'first open before publication';
      const view = await renderRecords(
        controller,
        recentRouteProps(),
        true,
        Ownership,
      );
      try {
        expect(await screen.findByTestId(row)).toBeTruthy();
        if (journey !== 'first open before publication') {
          if (journey === 'settings Back') {
            await act(async () => {
              controller.push('settings-provider');
            });
          } else {
            await act(async () => phase('background'));
          }
          expect(screen.queryByTestId(row)).toBeNull();
          armed = true;
          if (journey === 'settings Back') {
            await act(async () => {
              await controller.requestBack();
            });
          } else {
            await act(async () => phase('active'));
          }
          expect(await screen.findByTestId(row)).toBeTruthy();
        }
        expect(conflicts).toBe(writeCount);
        expect(screen.queryByTestId('records-recent-sources-error')).toBeNull();
        expect(screen.queryByText('Synthetic private Memory text')).toBeNull();
      } finally {
        await act(async () => view.unmount());
      }
    } finally {
      appState.mockRestore();
      AppState.currentState = 'active';
      f.close();
    }
  },
);
