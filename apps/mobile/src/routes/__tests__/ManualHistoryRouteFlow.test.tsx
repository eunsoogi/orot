import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { RecordsRoute } from '../RecordsRoute';
import { ManualHistoryRoute } from '../ManualHistoryRoute';

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
