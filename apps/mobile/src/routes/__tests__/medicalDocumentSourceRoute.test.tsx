import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordsRoute } from '../RecordsRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('opens saved medical document text and page provenance from Records', async () => {
  const source = {
    id: 'document-saved',
    sourceKind: 'medical_document' as const,
    title: 'Synthetic saved source.pdf',
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
  };
  const detail = {
    ...source,
    evidenceSpans: [
      {
        id: 'saved-span',
        sourceRecordId: source.id,
        text: 'Synthetic saved page text',
        pageNumber: 2,
        ingestedAt: source.ingestedAt,
        provenance: {
          origin: 'imported' as const,
          sourceRecordIds: [source.id],
        },
        reviewState: source.reviewState,
        locator: {
          kind: 'document_range' as const,
          pageNumber: 2,
          startOffset: 0,
          endOffset: 26,
        },
      },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([source]),
    getDocument: jest.fn().mockResolvedValue(detail),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  await render(
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
    />,
  );

  await fireEvent.press(await screen.findByTestId('medical-document-source-0'));

  expect(service.getDocument).toHaveBeenCalledWith(source.id);
  expect(screen.getByTestId('medical-document-source-title')).toHaveTextContent(
    source.title,
  );
  expect(
    screen.getByTestId('medical-document-source-review-state'),
  ).toHaveTextContent('아직 검토되지 않았어요.');
  expect(
    screen.getByTestId('medical-document-source-locator-0'),
  ).toHaveTextContent('2쪽 · 위치 1–26');
  expect(
    screen.getByTestId('medical-document-source-text-0'),
  ).toHaveTextContent('Synthetic saved page text');
  await fireEvent.press(screen.getByTestId('medical-document-source-back'));
  expect(await screen.findByTestId('medical-document-source-0')).toBeTruthy();
});
