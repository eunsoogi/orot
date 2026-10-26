import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordsRoute } from '../RecordsRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('keeps existing record actions visible and offers medical document import', async () => {
  const onOpenSymptoms = jest.fn();
  const onOpenRecording = jest.fn();
  const onOpenHealthLibrary = jest.fn();
  const onOpenSavedRecordings = jest.fn();
  await render(
    <RecordsRoute
      onOpenSymptoms={onOpenSymptoms}
      onOpenSavedRecordings={onOpenSavedRecordings}
      onOpenRecording={onOpenRecording}
      onOpenHealthLibrary={onOpenHealthLibrary}
      documentImportService={{
        listDocuments: jest.fn().mockResolvedValue([]),
        getDocument: jest.fn().mockResolvedValue(null),
        selectDocument: jest.fn().mockResolvedValue(null),
        saveDocument: jest.fn(),
        discardDocument: jest.fn(),
      }}
    />,
  );

  expect(screen.getByTestId('records-new-recording')).toHaveTextContent(
    '새 상담 녹음',
  );
  expect(screen.getByText('가져온 건강 기록', { exact: true })).toBeTruthy();
  expect(screen.getByTestId('records-import-medical-document')).toBeTruthy();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();
  expect(screen.queryByTestId('recording-library-panel')).toBeNull();
  expect(
    await screen.findByTestId('medical-document-source-empty-list'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('records-open-saved-recordings'));
  expect(onOpenSavedRecordings).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(onOpenSymptoms).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
  expect(onOpenRecording).toHaveBeenCalledTimes(1);
  expect(onOpenHealthLibrary).toHaveBeenCalledTimes(1);
});

test('shows extracted text for review before saving medical evidence', async () => {
  const document = {
    id: 'document-1',
    displayName: 'synthetic-visit-note.pdf',
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      {
        id: 'span-1',
        text: 'Synthetic document text',
        pageNumber: 2,
        startOffset: 0,
        endOffset: 23,
      },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(document),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };

  await render(
    <RecordsRoute
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      documentImportService={service}
    />,
  );

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  expect(await screen.findByText('Synthetic document text')).toBeTruthy();
  expect(
    screen.getByText(
      '내용을 확인한 뒤 저장해 주세요. 진단과 약 변경은 자동으로 확정되지 않아요.',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-document-save'));

  expect(service.saveDocument).toHaveBeenCalledWith(document);
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
  expect(screen.getByText('문서와 출처를 저장했어요.')).toBeTruthy();
});

test('discards a reviewed document when the user cancels import', async () => {
  const document = {
    id: 'document-2',
    displayName: 'synthetic-note.txt',
    contentHash: `sha256:${'b'.repeat(64)}` as const,
    sections: [
      { id: 'span-2', text: 'Synthetic note', startOffset: 0, endOffset: 14 },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(document),
    saveDocument: jest.fn(),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  await render(
    <RecordsRoute
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      documentImportService={service}
    />,
  );

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await fireEvent.press(screen.getByTestId('medical-document-cancel'));

  expect(service.discardDocument).toHaveBeenCalledWith(document);
  expect(service.saveDocument).not.toHaveBeenCalled();
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});

test('retries a failed save while keeping the selected document available', async () => {
  const document = {
    id: 'document-retry',
    displayName: 'synthetic-retry-note.pdf',
    contentHash: `sha256:${'c'.repeat(64)}` as const,
    sections: [
      {
        id: 'span-retry',
        text: 'Synthetic retry note',
        pageNumber: 1,
        startOffset: 0,
        endOffset: 20,
      },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(document),
    saveDocument: jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic write failure.'))
      .mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  await render(
    <RecordsRoute
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      documentImportService={service}
    />,
  );

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await screen.findByText('Synthetic retry note');
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(
    await screen.findByText(
      '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Synthetic retry note')).toBeTruthy();
  expect(screen.getByTestId('medical-document-save')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('medical-document-save'));

  expect(service.saveDocument).toHaveBeenCalledTimes(2);
  expect(service.discardDocument).not.toHaveBeenCalled();
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});

test('lets the user cancel and clean up after a failed save', async () => {
  const document = {
    id: 'document-cancel-after-failure',
    displayName: 'synthetic-cancel-note.txt',
    contentHash: `sha256:${'d'.repeat(64)}` as const,
    sections: [
      {
        id: 'span-cancel',
        text: 'Synthetic cancel note',
        startOffset: 0,
        endOffset: 21,
      },
    ],
  };
  const service = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(document),
    saveDocument: jest
      .fn()
      .mockRejectedValue(new Error('Synthetic write failure.')),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  await render(
    <RecordsRoute
      onOpenSymptoms={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      documentImportService={service}
    />,
  );

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  await screen.findByText(
    '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('medical-document-cancel'));

  expect(service.saveDocument).toHaveBeenCalledTimes(1);
  expect(service.discardDocument).toHaveBeenCalledWith(document);
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});
