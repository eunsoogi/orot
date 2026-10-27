import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { RecordsRoute, type RecordsRouteProps } from '../RecordsRoute';
import type { MedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';

// Render both adaptive panels together; real width and text thresholds are covered natively.
jest.mock('../../layout/AdaptiveColumns', () => {
  const ReactRuntime = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AdaptiveColumns: ({
      primary,
      secondary,
      testID,
    }: {
      primary: ReactNode;
      secondary?: ReactNode;
      testID?: string;
    }) => ReactRuntime.createElement(View, { testID }, primary, secondary),
  };
});
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function document(id: string, text: string) {
  return {
    id,
    displayName: `${id}.pdf`,
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [
      {
        id: `span-${id}`,
        text,
        pageNumber: 1,
        startOffset: 0,
        endOffset: text.length,
      },
    ],
  };
}

function importService(
  overrides: Partial<MedicalDocumentImportService> = {},
): MedicalDocumentImportService {
  return {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
    ...overrides,
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
    ...overrides,
  };
}

async function renderRecordsRoute(
  overrides: Partial<RecordsRouteProps> = {},
): Promise<RecordsRouteProps> {
  const props = routeProps(overrides);
  await render(<RecordsRoute {...props} />);
  return props;
}

test('keeps existing Records actions and medical document import available', async () => {
  const props = await renderRecordsRoute({
    documentImportService: importService(),
  });

  expect(screen.getByTestId('records-new-recording')).toHaveTextContent(
    '새 상담 녹음',
  );
  expect(screen.getByText('가져온 건강 기록', { exact: true })).toBeTruthy();
  expect(screen.getByTestId('records-import-medical-document')).toBeTruthy();
  expect(
    await screen.findByTestId('medical-document-source-empty-list'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  await fireEvent.press(screen.getByTestId('records-open-saved-recordings'));
  await fireEvent.press(screen.getByTestId('records-open-manual-history'));
  await fireEvent.press(screen.getByTestId('records-open-health-library'));

  expect(props.onOpenRecording).toHaveBeenCalledTimes(1);
  expect(props.onOpenSymptoms).toHaveBeenCalledTimes(1);
  expect(props.onOpenSavedRecordings).toHaveBeenCalledTimes(1);
  expect(props.onOpenManualHistory).toHaveBeenCalledTimes(1);
  expect(props.onOpenHealthLibrary).toHaveBeenCalledTimes(1);
});

test('shows extracted text in the measured single panel before saving medical evidence', async () => {
  const selected = document('document-1', 'Synthetic document text');
  const service = importService({
    selectDocument: jest.fn().mockResolvedValue(selected),
  });
  await renderRecordsRoute({ documentImportService: service });

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  expect(await screen.findByText('Synthetic document text')).toBeTruthy();
  expect(screen.getByTestId('records-document-review-layout')).toBeTruthy();
  expect(
    screen.getByText(
      '내용을 확인한 뒤 저장해 주세요. 진단과 약 변경은 자동으로 확정되지 않아요.',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-document-save'));

  expect(service.saveDocument).toHaveBeenCalledWith(selected);
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
  expect(screen.getByText('문서와 출처를 저장했어요.')).toBeTruthy();
});

test('discards a reviewed document when the user cancels import', async () => {
  const selected = document('document-2', 'Synthetic note');
  const service = importService({
    selectDocument: jest.fn().mockResolvedValue(selected),
  });
  await renderRecordsRoute({ documentImportService: service });

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await fireEvent.press(screen.getByTestId('medical-document-cancel'));

  expect(service.discardDocument).toHaveBeenCalledWith(selected);
  expect(service.saveDocument).not.toHaveBeenCalled();
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});

test('retries a failed save while keeping the selected document available', async () => {
  const service = importService({
    selectDocument: jest
      .fn()
      .mockResolvedValue(document('document-retry', 'Synthetic retry note')),
    saveDocument: jest
      .fn()
      .mockRejectedValueOnce(new Error('Synthetic write failure.'))
      .mockResolvedValue('saved'),
  });
  await renderRecordsRoute({ documentImportService: service });

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await screen.findByText('Synthetic retry note');
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(
    await screen.findByText(
      '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Synthetic retry note')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-document-save'));

  expect(service.saveDocument).toHaveBeenCalledTimes(2);
  expect(service.discardDocument).not.toHaveBeenCalled();
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});

test('lets the user cancel and clean up after a failed save', async () => {
  const selected = document('document-cancel', 'Synthetic cancel note');
  const service = importService({
    selectDocument: jest.fn().mockResolvedValue(selected),
    saveDocument: jest
      .fn()
      .mockRejectedValue(new Error('Synthetic write failure.')),
  });
  await renderRecordsRoute({ documentImportService: service });

  await fireEvent.press(screen.getByTestId('records-import-medical-document'));
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  await screen.findByText(
    '문서를 불러오지 못했어요. 파일이 열리는지 확인해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('medical-document-cancel'));

  expect(service.saveDocument).toHaveBeenCalledTimes(1);
  expect(service.discardDocument).toHaveBeenCalledWith(selected);
  expect(screen.queryByTestId('medical-document-save')).toBeNull();
});
