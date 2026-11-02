import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SymptomEntry } from '@orot/storage';
import { RecordsRoute } from '../RecordsRoute';
import type { MedicalDocumentSourceRecord } from '../../medicalDocuments/medicalDocumentImportService';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function recordingSource(
  id: string,
  title: string,
  recordedAt: string,
): RecordingSourceRecord {
  return {
    id,
    sourceKind: 'audio_recording',
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    title,
  };
}

test('keeps other recent records visible when a document detail cannot be opened', async () => {
  const recordedAt = '2026-11-02T09:42:00.000Z';
  const recording: RecordingSourceRecord = {
    id: 'recording-recent-1',
    sourceKind: 'audio_recording',
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    title: '최근 상담',
  };
  const document = {
    id: 'document-recent-1',
    sourceKind: 'medical_document' as const,
    title: 'Clinic summary.pdf',
    ingestedAt: '2026-11-02T08:15:00.000Z',
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([document]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved' as const),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };

  await render(
    <RecordsRoute
      recordings={[recording]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
      loadSymptoms={async () => ({ list: async () => [] })}
    />,
  );

  await fireEvent.press(await screen.findByTestId('medical-document-source-0'));

  await waitFor(() => {
    expect(screen.getByTestId('medical-document-source-status')).toHaveTextContent(
      '문서를 찾을 수 없어요.',
    );
    expect(screen.getByTestId('records-recent-source-recording-recent-1')).toBeTruthy();
  });
  expect(service.getDocument).toHaveBeenCalledWith(document.id);
});

test('groups real recordings, imported documents and symptoms and preserves their destinations', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 12));
  try {
    const recording = recordingSource(
      'recording-recent-1',
      '상담 녹음',
      new Date(2026, 10, 2, 9, 42).toISOString(),
    );
    const olderRecording = recordingSource(
      'recording-recent-older',
      '이전 상담',
      new Date(2026, 9, 31, 20, 27).toISOString(),
    );
    const document: MedicalDocumentSourceRecord = {
      id: 'document-recent-1',
      sourceKind: 'medical_document',
      title: 'Clinic summary.pdf',
      ingestedAt: new Date(2026, 10, 2, 8, 15).toISOString(),
      provenance: { origin: 'imported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    };
    const symptom: SymptomEntry = {
      id: 'symptom-recent-1',
      effectiveAt: new Date(2026, 10, 1, 20, 10).toISOString(),
      recordedAt: new Date(2026, 10, 1, 20, 27).toISOString(),
      ingestedAt: new Date(2026, 10, 1, 20, 27).toISOString(),
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      description: 'Cough and mild fever',
      status: 'active',
    };
    const service = {
      listDocuments: jest.fn().mockResolvedValue([document]),
      getDocument: jest.fn().mockResolvedValue(null),
      selectDocument: jest.fn().mockResolvedValue(null),
      saveDocument: jest.fn().mockResolvedValue('saved' as const),
      discardDocument: jest.fn().mockResolvedValue(undefined),
    };
    const symptomRepository = {
      list: jest.fn().mockResolvedValue([symptom]),
    };
    const loadSymptoms = jest.fn().mockResolvedValue(symptomRepository);
    const onOpenSavedRecordings = jest.fn();
    const onOpenSymptoms = jest.fn();
    await render(
      <RecordsRoute
        recordings={[recording, olderRecording]}
        recordingState="ready"
        onRetryRecordings={jest.fn()}
        onOpenSymptoms={onOpenSymptoms}
        onOpenSavedRecordings={onOpenSavedRecordings}
        onOpenRecording={jest.fn()}
        onOpenHealthLibrary={jest.fn()}
        onOpenManualHistory={jest.fn()}
        documentImportService={service}
        loadSymptoms={loadSymptoms}
      />,
    );

    expect(screen.getByText('11월 2일 (오늘)')).toBeTruthy();
    expect(screen.getByText('11월 1일 (어제)')).toBeTruthy();
    expect(screen.getByText('Clinic summary.pdf')).toBeTruthy();
    expect(screen.getByText('Cough and mild fever')).toBeTruthy();
    expect(screen.getByTestId('records-recent-source-recording-recent-1')).toBeTruthy();
    expect(screen.queryByTestId('records-recent-source-recording-recent-older')).toBeNull();

    await fireEvent.press(screen.getByTestId('records-recent-view-all'));
    expect(screen.getByTestId('records-recent-source-recording-recent-older')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('records-recent-source-recording-recent-1'));
    await fireEvent.press(screen.getByTestId('records-recent-symptom-symptom-recent-1'));
    expect(onOpenSavedRecordings).toHaveBeenCalledTimes(1);
    expect(onOpenSymptoms).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('medical-document-source-0'));
    expect(service.getDocument).toHaveBeenCalledWith(document.id);
  } finally {
    jest.useRealTimers();
  }
});
