import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import type { RecentMaterialReadyLease } from '../../generatedReports/certifiedRecentMaterialPage';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
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
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(async () => []),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(async () => []),
  readSelectedRecentRecording: jest.fn(),
}));

const metadataRow = 'records-recent-source-memory:agent:admitted-memory';
const retry = 'records-recent-sources-retry';

test.each(['settles', 'native-lock'] as const)(
  'Records Back waits for the same protected writer before first witness: %s',
  async mode => {
    const oldAppState = AppState.currentState;
    AppState.currentState = 'active';
    let protectedData = true;
    const verify = jest.fn(async () => protectedData);
    jest.mocked(conversationExecutionNative).mockReturnValue({
      ...recentTestExecution,
      protectedDataAvailable: verify,
    });
    const entered = holdRecentTestPage<void>();
    const release = holdRecentTestPage<void>();
    const update = 'UPDATE records_admission_fixture SET occupied=1';
    const f = openInterleavableRecentSourceDatabase(query => {
      if (query !== update) return;
      entered.resolve();
      return release.promise;
    });
    const lease: RecentMaterialReadyLease = {
      database: f.database,
      isCurrent: () => true,
    };
    function Ownership({ children }: PropsWithChildren) {
      return (
        <RecentMaterialReadinessContext.Provider value={lease}>
          {children}
        </RecentMaterialReadinessContext.Provider>
      );
    }
    let write: Promise<unknown> | undefined;
    let mounted: Awaited<ReturnType<typeof renderRecords>> | undefined;
    try {
      await runMigrations(f.database);
      await f.database.execute(
        'CREATE TABLE records_admission_fixture(occupied INTEGER)',
      );
      await f.database.execute(
        'INSERT INTO records_admission_fixture VALUES(0)',
      );
      await new SqlCipherAgentMemoryStorage(f.database).append({
        id: 'admitted-memory',
        text: 'Synthetic protected text stays out of the Records feed',
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
      const controller = createNavigationController<AppNavigationRoute>('root');
      mounted = await renderRecords(
        controller,
        { ...recentRouteProps(), documentImportService: undefined },
        true,
        Ownership,
      );
      expect(await screen.findByTestId(metadataRow)).toBeTruthy();
      await act(() => {
        controller.push('settings-provider');
      });
      await fireEvent.press(await screen.findByTestId('model-tab-voice'));
      expect(
        await screen.findByTestId('voice-model-group-openai-api'),
      ).toBeTruthy();
      verify.mockClear();
      write = f.database.execute(update);
      await entered.promise;
      await act(async () => {
        await controller.requestBack();
      });
      await waitFor(() => expect(verify).toHaveBeenCalled());
      await act(async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setImmediate(resolve));
      });
      expect(screen.queryByTestId(metadataRow)).toBeNull();
      // This was the full-feed Retry on the old witness admission path.
      expect(screen.queryByTestId(retry)).toBeNull();
      expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
      if (mode === 'native-lock') protectedData = false;
      await act(async () => {
        release.resolve();
        await write;
      });
      if (mode === 'native-lock') {
        expect(await screen.findByTestId(retry)).toBeTruthy();
        expect(screen.queryByTestId(metadataRow)).toBeNull();
      } else {
        expect(await screen.findByTestId(metadataRow)).toBeTruthy();
        expect(screen.queryByTestId(retry)).toBeNull();
        expect(
          screen.queryByText(
            'Synthetic protected text stays out of the Records feed',
          ),
        ).toBeNull();
      }
    } finally {
      release.resolve();
      await write?.catch(() => undefined);
      await mounted?.unmount();
      AppState.currentState = oldAppState;
      f.close();
    }
  },
  20_000,
);
