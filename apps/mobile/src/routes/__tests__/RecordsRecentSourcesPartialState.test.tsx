import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordsRoute } from '../RecordsRoute';
import type { RecordsRouteProps } from '../RecordsRoute';
import type {
  MedicalDocumentImportService,
  MedicalDocumentSourceRecord,
} from '../../medicalDocuments/medicalDocumentImportService';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function medicalDocument(id: string): MedicalDocumentSourceRecord {
  return {
    id,
    sourceKind: 'medical_document',
    title: 'Clinic summary.pdf',
    ingestedAt: '2026-11-02T08:15:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  };
}

function documentImportService(
  documents: readonly MedicalDocumentSourceRecord[],
): MedicalDocumentImportService {
  return {
    listDocuments: jest.fn().mockResolvedValue(documents),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
}

function routeProps(
  overrides: Partial<RecordsRouteProps> = {},
): RecordsRouteProps {
  return {
    recordings: [],
    recordingState: 'ready',
    onRetryRecordings: jest.fn(),
    onOpenSymptoms: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    documentImportService: documentImportService([]),
    loadSymptoms: async () => ({ list: async () => [] }),
    ...overrides,
  };
}

test('retains loaded documents and their destination when recordings fail', async () => {
  const document = medicalDocument('document-ready-1');
  const service = documentImportService([document]);
  await render(
    <RecordsRoute
      {...routeProps({
        recordingState: 'failed',
        documentImportService: service,
      })}
    />,
  );

  await fireEvent.press(await screen.findByTestId('medical-document-source-0'));
  expect(service.getDocument).toHaveBeenCalledWith(document.id);
  expect(screen.getByText('Clinic summary.pdf')).toBeTruthy();
  expect(screen.getByTestId('records-recent-view-all')).toBeTruthy();
  expect(screen.getByTestId('records-recent-sources-error')).toHaveTextContent(
    '녹음 목록을 불러오지 못했어요.',
  );
});

test('retains loaded documents while recordings load', async () => {
  await render(
    <RecordsRoute
      {...routeProps({
        recordingState: 'loading',
        documentImportService: documentImportService([
          medicalDocument('document-ready-2'),
        ]),
      })}
    />,
  );

  expect(await screen.findByTestId('medical-document-source-0')).toBeTruthy();
  expect(screen.getByText('Clinic summary.pdf')).toBeTruthy();
  expect(screen.getByTestId('records-recent-view-all')).toBeTruthy();
  expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
});

test('retains loaded documents when symptom loading fails', async () => {
  const loadSymptoms = jest
    .fn()
    .mockRejectedValue(new Error('Local symptom read failed.'));
  await render(
    <RecordsRoute
      {...routeProps({
        loadSymptoms,
        documentImportService: documentImportService([
          medicalDocument('document-ready-3'),
        ]),
      })}
    />,
  );

  expect(await screen.findByTestId('medical-document-source-0')).toBeTruthy();
  expect(screen.getByText('Clinic summary.pdf')).toBeTruthy();
  expect(screen.getByTestId('records-recent-view-all')).toBeTruthy();
  expect(screen.getByTestId('records-recent-sources-error')).toHaveTextContent(
    '증상 기록을 불러오지 못했어요.',
  );
});

test('shows loading and source-specific failure while retaining loaded documents', async () => {
  await render(
    <RecordsRoute
      {...routeProps({
        recordingState: 'failed',
        documentImportService: documentImportService([
          medicalDocument('document-ready-4'),
        ]),
        loadSymptoms: async () => ({
          list: () => new Promise<never>(() => {}),
        }),
      })}
    />,
  );

  expect(await screen.findByTestId('medical-document-source-0')).toBeTruthy();
  expect(screen.getByText('Clinic summary.pdf')).toBeTruthy();
  expect(screen.getByTestId('records-recent-view-all')).toBeTruthy();
  expect(screen.getByTestId('records-recent-sources-loading')).toBeTruthy();
  expect(screen.getByTestId('records-recent-sources-error')).toHaveTextContent(
    '녹음 목록을 불러오지 못했어요.',
  );
});
