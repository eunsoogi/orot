import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { loadRecentSourceMaterial } from '../recentSourceReader';
import {
  holdRecentTestPage,
  pendingVisitReports,
  recentRouteProps,
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
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(),
}));
jest.mock('../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
  },
}));

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
  jest
    .mocked(loadRecentMaterial)
    .mockResolvedValue(pendingVisitReports().slice(0, 1));
});

async function seedFile(
  f: ReturnType<typeof openInterleavableRecentSourceDatabase>,
) {
  await runMigrations(f.database);
  await createRecordRepository(f.database).put('source_record', {
    id: 'previous-file',
    sourceKind: 'medical_document',
    ingestedAt: '2026-11-22T09:31:00.000Z',
    title: 'Synthetic carried-forward file',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  jest
    .mocked(loadRecentSourceMaterial)
    .mockClear()
    .mockImplementation(async (before, options) => {
      const rows = await readCommittedRecentSourcePage(
        f.database,
        before && { id: before.key, createdAt: before.createdAt },
        options?.signal,
        options?.canRetry,
      );
      return rows.map(row => ({ ...row, key: row.id }));
    });
}

function mountRecords() {
  return renderRecords(
    createNavigationController<AppNavigationRoute>('root'),
    { ...recentRouteProps(), documentImportService: undefined },
    true,
  );
}

test('first Records entry after v17 upgrade retains its report without an error flash while media is awaiting a direct startup statement', async () => {
  const entered = holdRecentTestPage<void>();
  const startup = holdRecentTestPage<void>();
  const f = openInterleavableRecentSourceDatabase(query => {
    if (query !== 'PRAGMA temp_store = MEMORY') return;
    entered.resolve();
    return startup.promise;
  });
  let operation: Promise<unknown> | undefined;
  let mounted: Awaited<ReturnType<typeof mountRecords>> | undefined;
  try {
    await seedFile(f);
    // Model the installed v17 artifact's storage state without removing retained data.
    await f.database.execute('DROP INDEX source_records_recent_page_idx');
    await f.database.execute('PRAGMA user_version = 17');
    await runMigrations(f.database);
    operation = f.database.execute('PRAGMA temp_store = MEMORY');
    await entered.promise;
    mounted = await mountRecords();
    await waitFor(() =>
      expect(screen.getByTestId('records-recent-source-visit:30')).toBeTruthy(),
    );
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    expect(screen.queryByTestId('records-recent-sources-error')).toBeNull();
    expect(screen.queryByTestId('records-recent-sources-retry')).toBeNull();
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
    await act(async () => {
      startup.resolve();
      await operation;
    });
    expect(
      await screen.findByText('Synthetic carried-forward file'),
    ).toBeTruthy();
    expect(screen.getByTestId('records-recent-source-visit:30')).toBeTruthy();
    expect(screen.queryByTestId('records-recent-sources-error')).toBeNull();
    expect(screen.queryByTestId('records-recent-sources-loading')).toBeNull();
  } finally {
    startup.resolve();
    await operation?.catch(() => undefined);
    await mounted?.unmount();
    f.close();
  }
});

test('a genuinely failed indexed query still offers Retry without removing the successful report', async () => {
  const f = openInterleavableRecentSourceDatabase();
  let mounted: Awaited<ReturnType<typeof mountRecords>> | undefined;
  try {
    await seedFile(f);
    await f.database.execute('DROP INDEX source_records_recent_page_idx');
    mounted = await mountRecords();
    expect(
      await screen.findByTestId('records-recent-sources-error'),
    ).toBeTruthy();
    expect(screen.getByTestId('records-recent-source-visit:30')).toBeTruthy();
    expect(jest.mocked(loadRecentSourceMaterial)).toHaveBeenCalledTimes(1);
    await f.database.execute('PRAGMA user_version = 17');
    await runMigrations(f.database);
    await fireEvent.press(screen.getByTestId('records-recent-sources-retry'));
    expect(
      await screen.findByText('Synthetic carried-forward file'),
    ).toBeTruthy();
    expect(screen.queryByTestId('records-recent-sources-error')).toBeNull();
    expect(jest.mocked(loadRecentSourceMaterial)).toHaveBeenCalledTimes(2);
  } finally {
    await mounted?.unmount();
    f.close();
  }
});

test('a fresh native denial after startup contention prevents the deferred media read', async () => {
  const startup = holdRecentTestPage<void>();
  let allowed = true;
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...jest.mocked(conversationExecutionNative)()!,
    protectedDataAvailable: async () => allowed,
  });
  const f = openInterleavableRecentSourceDatabase(query =>
    query === 'PRAGMA temp_store = MEMORY' ? startup.promise : undefined,
  );
  let operation: Promise<unknown> | undefined;
  let mounted: Awaited<ReturnType<typeof mountRecords>> | undefined;
  try {
    await seedFile(f);
    operation = f.database.execute('PRAGMA temp_store = MEMORY');
    mounted = await mountRecords();
    expect(
      await screen.findByTestId('records-recent-source-visit:30'),
    ).toBeTruthy();
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
    allowed = false;
    await act(async () => {
      startup.resolve();
      await operation;
    });
    expect(
      await screen.findByTestId('records-recent-sources-error'),
    ).toBeTruthy();
    expect(screen.queryByText('Synthetic carried-forward file')).toBeNull();
  } finally {
    startup.resolve();
    await operation?.catch(() => undefined);
    await mounted?.unmount();
    f.close();
  }
});
