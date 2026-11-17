import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { openLocalManualHistoryRepository } from '../../manualHistory/localRepository';
import { selectTestRoute } from '../../../e2e/testRoute';
import { SavedMemoryBrowser } from '../../memory/SavedMemoryBrowser';
import { SavedMemoryDetail } from '../../memory/SavedMemoryDetail';
import {
  unifySavedMemories,
  type SavedMemory,
} from '../../memory/unifiedSavedMemories';
import { AppState } from 'react-native';
import { AppButton } from '../../layout/AppButton';

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(() => ({ deleteChunks: jest.fn() })),
}));

const mockedOpenLocalAgentMemoryDatabase = jest.mocked(
  openLocalAgentMemoryDatabase,
);
const mockedOpenLocalStorage = jest.mocked(openLocalStorage);

test('admits manual-history recovery only as an explicit test scenario', () => {
  expect(
    selectTestRoute({ OROT_TEST_SCENARIO: 'manual-history-recovery' }),
  ).toBe('manual-history-recovery');
  expect(selectTestRoute({ OROT_TEST_PROFILE: 'core' })).toBe('core');
  expect(() =>
    selectTestRoute({ OROT_TEST_SCENARIO: 'manual-history-recovery-typo' }),
  ).toThrow('Unsupported test scenario');
});

/** A seeded original stands in for existing user data; new manual creation is deliberately absent. */
function MemoryRoutes({ load }: { load: () => Promise<SavedMemory[]> }) {
  const [id, setId] = useState<string | null>(null);
  return id ? (
    <>
      <SavedMemoryDetail memoryId={id} load={load} />
      <AppButton title="목록으로" onPress={() => setId(null)} />
    </>
  ) : (
    <SavedMemoryBrowser load={load} onOpenMemory={setId} />
  );
}

async function setupDatabase() {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const storage = createRecordRepository(database);
  mockedOpenLocalStorage.mockResolvedValue(storage);
  mockedOpenLocalAgentMemoryDatabase.mockResolvedValue(database);
  const repository = await openLocalManualHistoryRepository();
  await repository.create({
    kind: 'note',
    title: 'Synthetic history query marker',
    details: 'Synthetic persisted details.',
    effectiveDate: { status: 'unknown' },
  });
  const load = async () => unifySavedMemories([], await repository.list());
  return { storage, load, close };
}

test('opens existing originals through Memory, corrects, leaves and reloads without a manual-create entry', async () => {
  const { storage, load, close } = await setupDatabase();
  const view = await render(<MemoryRoutes load={load} />);
  try {
    expect(view.queryByTestId('records-open-manual-history')).toBeNull();
    expect(view.queryByTestId('manual-history-add')).toBeNull();
    await fireEvent.press(view.getByText(/Synthetic history query marker/));
    await view.findByTestId('manual-history-correct');
    await fireEvent.press(view.getByTestId('manual-history-correct'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic corrected details.',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));
    await view.findByTestId('manual-history-correct');
    await fireEvent.press(view.getByText('목록으로'));
    await fireEvent.press(view.getByText(/Synthetic history query marker/));
    await view.findByTestId('manual-history-correction-history');
    expect(
      view.getAllByText('Synthetic corrected details.').length,
    ).toBeGreaterThan(0);
    await expect(
      storage.manualHistory.list({ search: 'query marker' }),
    ).resolves.toHaveLength(1);
    await expect(
      storage.manualHistory.list({ dateStatus: 'unknown' }),
    ).resolves.toHaveLength(1);
    const entries = await storage.manualHistory.list();
    await expect(
      storage.manualHistory.history(entries[0].id),
    ).resolves.toHaveLength(2);
  } finally {
    await view.unmount();
    close();
    mockedOpenLocalStorage.mockReset();
    mockedOpenLocalAgentMemoryDatabase.mockReset();
  }
});

test('retries a failed unified read and opens the preserved original', async () => {
  const { load, close } = await setupDatabase();
  const retryLoad = jest
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic locked store'))
    .mockImplementation(load);
  const view = await render(<MemoryRoutes load={retryLoad} />);
  try {
    await fireEvent.press(view.getByText('다시 시도'));
    expect(retryLoad).toHaveBeenCalledTimes(2);
    await fireEvent.press(view.getByText(/Synthetic history query marker/));
    await view.findByTestId('manual-history-correct');
    await fireEvent.press(view.getByText('목록으로'));
    expect(view.getByTestId('saved-memory-browser')).toBeTruthy();
  } finally {
    await view.unmount();
    close();
    mockedOpenLocalStorage.mockReset();
    mockedOpenLocalAgentMemoryDatabase.mockReset();
  }
});
