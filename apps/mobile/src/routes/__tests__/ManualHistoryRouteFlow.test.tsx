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
import { RecordsRoute } from '../RecordsRoute';
import {
  ManualHistoryRepositoryOpenerContext,
  ManualHistoryRoute,
} from '../ManualHistoryRoute';

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

function RecordsAndManualHistoryRoutes() {
  const [showManualHistory, setShowManualHistory] = useState(false);
  if (showManualHistory) {
    return <ManualHistoryRoute onBack={() => setShowManualHistory(false)} />;
  }
  return (
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={() => undefined}
      onOpenSymptoms={() => undefined}
      onOpenSavedRecordings={() => undefined}
      onOpenRecording={() => undefined}
      onOpenHealthLibrary={() => undefined}
      onOpenManualHistory={() => setShowManualHistory(true)}
    />
  );
}

test('opens from Records, saves, leaves, and reloads a structured manual-history entry', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const storage = createRecordRepository(database);
  mockedOpenLocalStorage.mockResolvedValue(storage);
  mockedOpenLocalAgentMemoryDatabase.mockResolvedValue(database);
  const view = await render(<RecordsAndManualHistoryRoutes />);
  try {
    await fireEvent.press(view.getByTestId('records-open-manual-history'));
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic history query marker',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic persisted details for the route integration test.',
    );
    await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
    await fireEvent.press(view.getByTestId('manual-history-save'));
    await view.findByText('Synthetic history query marker');

    await fireEvent.press(view.getByTestId('manual-history-back'));
    expect(view.getByTestId('records-title')).toBeTruthy();
    await fireEvent.press(view.getByTestId('records-open-manual-history'));
    await view.findByText('Synthetic history query marker');

    await expect(
      storage.manualHistory.list({ search: 'query marker' }),
    ).resolves.toHaveLength(1);
    await expect(
      storage.manualHistory.list({ dateStatus: 'unknown' }),
    ).resolves.toHaveLength(1);
  } finally {
    view.unmount();
    close();
    mockedOpenLocalStorage.mockReset();
    mockedOpenLocalAgentMemoryDatabase.mockReset();
  }
});

test('retries a failed route open through the real repository and returns to Records', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const storage = createRecordRepository(database);
  mockedOpenLocalStorage.mockResolvedValue(storage);
  mockedOpenLocalAgentMemoryDatabase.mockResolvedValue(database);
  let attempts = 0;
  const openRepository = jest.fn(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Synthetic repository-open failure.');
    return openLocalManualHistoryRepository();
  });
  const view = await render(
    <ManualHistoryRepositoryOpenerContext.Provider value={openRepository}>
      <RecordsAndManualHistoryRoutes />
    </ManualHistoryRepositoryOpenerContext.Provider>,
  );
  try {
    await fireEvent.press(view.getByTestId('records-open-manual-history'));
    await view.findByTestId('route-load-retry');
    expect(openRepository).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByTestId('route-load-retry'));
    await view.findByTestId('manual-history-empty');
    expect(openRepository).toHaveBeenCalledTimes(2);
    expect(mockedOpenLocalStorage).toHaveBeenCalledTimes(1);
    expect(mockedOpenLocalAgentMemoryDatabase).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByTestId('manual-history-back'));
    expect(view.getByTestId('records-title')).toBeTruthy();
  } finally {
    view.unmount();
    close();
    mockedOpenLocalStorage.mockReset();
    mockedOpenLocalAgentMemoryDatabase.mockReset();
  }
});
