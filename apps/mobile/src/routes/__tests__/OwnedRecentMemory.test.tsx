import { act, fireEvent, screen } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
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

test('owned readiness reveals saved Memory in both Records routes and a commit removes it', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
  const f = openInterleavableRecentSourceDatabase();
  const database = guardedNativeDatabase(f.database);
  const memory = new SqlCipherAgentMemoryStorage(database);
  const id = 'synthetic-owned-memory';
  const rowKey = 'records-recent-source-memory:agent:' + id;
  let publish!: (ready?: RecentMaterialReadyLease) => void;
  let current = true;
  function Ownership({ children }: PropsWithChildren) {
    const [ready, setReady] = useState<RecentMaterialReadyLease>();
    publish = setReady;
    return (
      <RecentMaterialReadinessContext.Provider value={ready}>
        {children}
      </RecentMaterialReadinessContext.Provider>
    );
  }
  try {
    await runMigrations(database);
    await memory.append({
      id,
      text: 'Synthetic private memory text',
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
    const view = await renderRecords(
      controller,
      recentRouteProps(),
      true,
      Ownership,
    );
    try {
      expect(screen.queryByTestId(rowKey)).toBeNull();
      await act(async () => {
        publish({ database, isCurrent: () => current });
      });
      expect(await screen.findByTestId(rowKey)).toBeTruthy();
      expect(screen.queryByText('Synthetic private memory text')).toBeNull();

      await fireEvent.press(screen.getByTestId('records-recent-view-all'));
      expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
      expect(await screen.findByTestId(rowKey)).toBeTruthy();

      await act(async () => {
        await memory.tombstone(id);
      });
      expect(screen.queryByTestId(rowKey)).toBeNull();
      await act(async () => {
        current = false;
        publish();
      });
      expect(screen.queryByTestId(rowKey)).toBeNull();
    } finally {
      await act(async () => view.unmount());
    }
  } finally {
    f.close();
  }
});
