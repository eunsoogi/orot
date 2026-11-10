import { act, fireEvent, render, screen } from '@testing-library/react-native';
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
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    documentImportService: documentImportService([]),
    ...overrides,
  };
}

test('retains loaded documents and their destination when recordings fail', async () => {
  const document = medicalDocument('document-ready-1');
  const service = documentImportService([document]);
  const retryRecordings = jest.fn();
  await render(
    <RecordsRoute
      {...routeProps({
        recordingState: 'failed',
        documentImportService: service,
        onRetryRecordings: retryRecordings,
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
  await fireEvent.press(screen.getByTestId('records-recent-sources-retry'));
  expect(retryRecordings).toHaveBeenCalledTimes(1);
  expect(service.listDocuments).toHaveBeenCalledTimes(1);
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

test('ignores an old document list when the current reader has already settled', async () => {
  let resolveOld!: (rows: MedicalDocumentSourceRecord[]) => void;
  const pending = new Promise<MedicalDocumentSourceRecord[]>(resolve => {
    resolveOld = resolve;
  });
  const props = routeProps();
  const route = await render(
    <RecordsRoute
      {...props}
      documentImportService={{
        ...documentImportService([]),
        listDocuments: () => pending,
      }}
    />,
  );
  await route.rerender(
    <RecordsRoute
      {...props}
      documentImportService={documentImportService([])}
    />,
  );
  await screen.findByTestId('records-recent-sources-empty');
  await act(async () => resolveOld([medicalDocument('obsolete')]));
  expect(screen.getByTestId('records-recent-sources-empty')).toBeTruthy();
  expect(screen.queryByTestId('medical-document-source-0')).toBeNull();
});
