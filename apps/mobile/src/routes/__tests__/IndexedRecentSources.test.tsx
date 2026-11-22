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
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    currentPhase: () => 'active',
    begin: jest.fn(),
    end: jest.fn(),
    isActive: jest.fn(),
  });
});

test('built-in Records uses one bounded media cursor independently of held reports and opens exact originals', async () => {
  const f = openInterleavableRecentSourceDatabase();
  const reports = holdRecentTestPage<RecentMaterialRow[]>();
  const olderReports = holdRecentTestPage<RecentMaterialRow[]>();
  const reportPages = pendingVisitReports();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const app = recentRouteProps();
    const source = {
      ...app.recordings[0]!,
      id: 'audio-43',
      recordedAt: timestamp,
      ingestedAt: '2026-11-22T09:33:00.000Z',
      recordingDurationMs: 120,
    };
    for (let i = 0; i < 44; i++) {
      await records.put('source_record', {
        ...source,
        id: 'audio-' + String(i).padStart(2, '0'),
      });
    }
    for (const [id, title, ingestedAt] of [
      [
        'imported-photo',
        'Synthetic imported photo',
        '2026-11-22T09:31:00.000Z',
      ],
      ['imported-file', 'Synthetic imported file', '2026-11-22T09:29:00.000Z'],
    ]) {
      await records.put('source_record', {
        sourceKind: 'medical_document',
        id,
        title,
        ingestedAt,
        provenance: { origin: 'imported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
      });
    }
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

    expect(await screen.findByText('Synthetic imported photo')).toBeTruthy();
    expect(screen.getByTestId('records-recent-source-audio-43')).toBeTruthy();
    expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
    expect(
      screen.queryByTestId('records-recent-source-synthetic-0'),
    ).toBeNull();
    expect(medicalDocumentImportService.listDocuments).not.toHaveBeenCalled();
    expect(readAudio).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('records-recent-view-all'));
    const scrollHost = screen.getByTestId('navigation-route-scroll');
    const more = await screen.findByTestId('records-recent-show-more');
    expect(more).toBeEnabled();
    await fireEvent.press(more);
    expect(
      await screen.findByTestId('records-recent-source-audio-24'),
    ).toBeTruthy();
    expect(page).toHaveBeenLastCalledWith({
      key: 'audio-25',
      createdAt: timestamp,
    });
    expect(screen.queryByTestId('records-recent-source-visit:30')).toBeNull();
    await act(async () => {
      reports.resolve(reportPages.slice(0, 20));
    });
    await waitFor(() =>
      expect(reportRead).toHaveBeenLastCalledWith({
        key: 'visit:11',
        createdAt: reportPages[19].createdAt,
      }),
    );
    expect(screen.getByTestId('records-recent-show-more')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('records-recent-show-more'));
    expect(await screen.findByText('Synthetic imported file')).toBeTruthy();
    expect(page).toHaveBeenLastCalledWith({
      key: 'audio-05',
      createdAt: timestamp,
    });
    expect(screen.queryByTestId('records-recent-source-visit:10')).toBeNull();
    await act(async () => {
      olderReports.resolve(reportPages.slice(20));
    });
    expect(
      await screen.findByTestId('records-recent-source-visit:10'),
    ).toBeTruthy();
    expect(
      screen.getAllByTestId('records-recent-source-audio-43'),
    ).toHaveLength(1);
    const known = screen.getAllByTestId(/^records-recent-source-(visit|audio)/);
    expect(known[0]?.props.testID).toBe('records-recent-source-visit:30');
    expect(screen.getByTestId('navigation-route-scroll')).toBe(scrollHost);
    expect(screen.getByText('Synthetic imported file')).toBeTruthy();

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
