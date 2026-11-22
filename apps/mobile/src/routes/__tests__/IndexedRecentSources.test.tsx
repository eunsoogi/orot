import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { readCommittedRecentSourcePage } from '../../storage/committedRecentSourcePage';
import { openInterleavableRecentSourceDatabase } from '../../storage/testSupport/interleavableRecentSourceDatabase';
import type { RecentMaterialRow } from '../../generatedReports/catalog';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { medicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { notifyRecentSourceSaved } from '../../storage/recentSourceEvents';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  loadRecentSourceMaterial,
  readSelectedRecentRecording,
} from '../recentSourceReader';
import {
  holdRecentTestPage,
  pendingVisitReports,
  seedIndexedRecentSources,
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
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../recentSourceReader', () => ({
  loadRecentSourceMaterial: jest.fn(),
  readSelectedRecentRecording: jest.fn(),
}));
jest.mock('../../medicalDocuments/medicalDocumentImportService', () => ({
  medicalDocumentImportService: {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
  },
}));

const timestamp = '2026-11-22T09:30:00.000Z';

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
});

test('built-in Records exposes only the certified global prefix and opens exact originals', async () => {
  const f = openInterleavableRecentSourceDatabase();
  const reports = holdRecentTestPage<RecentMaterialRow[]>();
  const olderReports = holdRecentTestPage<RecentMaterialRow[]>();
  const reportPages = pendingVisitReports().map((report, index) => ({
    ...report,
    // The optional stream straddles the imported photo and hides a newer report on page two.
    createdAt:
      index < 12 ? '2026-11-22T18:32:00.000+09:00' : '2026-11-22T09:30:30.000Z',
  }));
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const app = recentRouteProps();
    const source = await seedIndexedRecentSources(
      records,
      app.recordings[0]!,
      timestamp,
    );
    const page = jest.mocked(loadRecentSourceMaterial);
    page
      .mockClear()
      .mockImplementation(async before =>
        (
          await readCommittedRecentSourcePage(
            f.database,
            before && { id: before.key, createdAt: before.createdAt },
          )
        ).map(row => ({ ...row, key: row.id })),
      );
    const reportRead = jest.mocked(loadRecentMaterial);
    reportRead
      .mockClear()
      .mockImplementation(before =>
        before ? olderReports.promise : reports.promise,
      );
    jest
      .mocked(medicalDocumentImportService.getDocument)
      .mockImplementation(async id => {
        const selected = await records.transaction(tx =>
          tx.get('source_record', id),
        );
        return selected?.sourceKind === 'medical_document'
          ? { ...selected, evidenceSpans: [] }
          : null;
      });
    const readAudio = jest.mocked(readSelectedRecentRecording);
    readAudio.mockClear().mockImplementation(async id => {
      const selected = await records.transaction(tx =>
        tx.get('source_record', id),
      );
      return selected?.sourceKind === 'audio_recording' ? selected : null;
    });
    const controller = createNavigationController<AppNavigationRoute>('root');
    await renderRecords(
      controller,
      { ...app, documentImportService: undefined },
      true,
    );

    await act(async () => {
      await page.mock.results[0]?.value;
    });
    expect(page).toHaveBeenCalled();
    expect(screen.queryByText('Synthetic imported photo')).toBeNull();
    expect(screen.queryByTestId('records-recent-source-audio-43')).toBeNull();
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
    expect(medicalDocumentImportService.listDocuments).not.toHaveBeenCalled();
    expect(readAudio).not.toHaveBeenCalled();
    await act(async () => {
      reports.resolve(reportPages.slice(0, 20));
    });
    expect(
      await screen.findByTestId('records-recent-source-visit:30'),
    ).toBeTruthy();
    expect(screen.queryByText('Synthetic imported photo')).toBeNull();
    await fireEvent.press(screen.getByTestId('records-recent-view-all'));
    const scrollHost = screen.getByTestId('navigation-route-scroll');
    const rows = () =>
      screen.getAllByTestId(
        /^(records-recent-source-(visit|audio)|medical-document-source-)/,
      );
    expect(rows()).toHaveLength(20);
    expect(rows()[12]?.props.testID).toBe('medical-document-source-0');

    await fireEvent.press(
      await screen.findByTestId('records-recent-show-more'),
    );
    await waitFor(() =>
      expect(reportRead).toHaveBeenLastCalledWith({
        key: 'visit:11',
        createdAt: reportPages[19].createdAt,
      }),
    );
    await waitFor(() =>
      expect(page).toHaveBeenLastCalledWith({
        key: 'audio-25',
        createdAt: timestamp,
      }),
    );
    expect(rows()).toHaveLength(21);
    expect(screen.queryByTestId('records-recent-source-audio-43')).toBeNull();
    expect(screen.queryByText('Synthetic imported file')).toBeNull();
    await act(async () => {
      olderReports.resolve(reportPages.slice(20));
    });
    expect(
      await screen.findByTestId('records-recent-source-visit:10'),
    ).toBeTruthy();
    expect(rows()).toHaveLength(40);
    expect(rows()[21]?.props.testID).toBe('records-recent-source-visit:10');
    expect(rows()[22]?.props.testID).toBe('records-recent-source-audio-43');
    expect(screen.getByTestId('navigation-route-scroll')).toBe(scrollHost);
    expect(screen.queryByText('Synthetic imported file')).toBeNull();

    await fireEvent.press(screen.getByTestId('records-recent-show-more'));
    await waitFor(() =>
      expect(page).toHaveBeenLastCalledWith({
        key: 'audio-05',
        createdAt: timestamp,
      }),
    );
    expect(
      await screen.findByTestId('records-recent-source-audio-06'),
    ).toBeTruthy();
    expect(rows()).toHaveLength(60);
    expect(screen.queryByText('Synthetic imported file')).toBeNull();
    await fireEvent.press(screen.getByTestId('records-recent-show-more'));
    expect(await screen.findByText('Synthetic imported file')).toBeTruthy();
    expect(rows()).toHaveLength(67);
    expect(new Set(rows().map(row => row.props.testID)).size).toBe(67);

    await fireEvent.press(screen.getByTestId('medical-document-source-1'));
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'medical-document-detail',
    );
    expect(medicalDocumentImportService.getDocument).toHaveBeenCalledWith(
      'imported-file',
    );
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(screen.getByText('Synthetic imported file')).toBeTruthy();

    let release!: (value: RecordingSourceRecord) => void;
    readAudio.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    await fireEvent.press(screen.getByTestId('records-recent-source-audio-43'));
    expect(readAudio).toHaveBeenLastCalledWith('audio-43');
    await act(async () => {
      await records.sourceRecords.delete('audio-43');
      notifyLocalSourceDeleted();
      release(source);
    });
    expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
    expect(screen.queryByTestId('records-recent-source-audio-43')).toBeNull();
    if (!screen.queryByTestId('records-recent-source-audio-42'))
      await fireEvent.press(
        await screen.findByTestId('records-recent-show-more'),
      );
    await fireEvent.press(
      await screen.findByTestId('records-recent-source-audio-42'),
    );
    expect(readAudio).toHaveBeenLastCalledWith('audio-42');
    expect(await screen.findByTestId('recording-review-layout')).toBeTruthy();
    expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
    await fireEvent.press(screen.getByTestId('navigation-back'));

    await act(async () => {
      await records.put('source_record', {
        ...source,
        id: 'newly-saved',
        recordedAt: '2026-11-22T09:32:00.000Z',
      });
      notifyRecentSourceSaved();
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('records-recent-source-newly-saved'),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('records-recent-show-more')).toBeEnabled();
    expect(medicalDocumentImportService.listDocuments).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      reports.resolve([]);
      olderReports.resolve([]);
    });
    f.close();
  }
});
