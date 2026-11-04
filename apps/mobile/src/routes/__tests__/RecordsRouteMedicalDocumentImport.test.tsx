import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { RecordsRoute } from '../RecordsRoute';
import type { MedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';

// This test isolates the real route state; native Simulator coverage owns measured reachability.
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

function document(id: string) {
  return {
    id,
    displayName: `${id}.pdf`,
    contentHash: `sha256:${'a'.repeat(64)}` as const,
    sections: [],
  };
}

test('disables the Records body import action while the picker is opening', async () => {
  let finishSelection!: (selected: ReturnType<typeof document> | null) => void;
  const selection = new Promise<ReturnType<typeof document> | null>(resolve => {
    finishSelection = resolve;
  });
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn(() => selection),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  await render(
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
    />,
  );

  // Hold the native picker result pending to observe the disabled body action.
  const selectionPress = fireEvent.press(
    screen.getByTestId('records-import-medical-document'),
  );
  await waitFor(() => {
    expect(screen.getByText(t('medicalDocument.import.opening'))).toBeTruthy();
    expect(
      screen.getByTestId('records-import-medical-document'),
    ).toBeDisabled();
  });
  expect(service.selectDocument).toHaveBeenCalledTimes(1);

  await act(async () => {
    finishSelection(null);
    await selection;
  });
  await selectionPress;

  expect(screen.getByTestId('records-import-medical-document')).toBeEnabled();
  expect(screen.getByText(t('medicalDocument.import.summary'))).toBeTruthy();
});

test('routes Photos selection separately and returns to both actions after cancellation', async () => {
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  await render(
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
    />,
  );
  await fireEvent.press(screen.getByTestId('records-import-medical-photo'));
  expect(service.selectDocument).toHaveBeenCalledWith('photos');
  expect(screen.getByTestId('records-import-medical-document')).toBeEnabled();
  expect(screen.getByTestId('records-import-medical-photo')).toBeEnabled();
});

test('reviews the selected photo and saves through the existing document service', async () => {
  const photo = {
    ...document('synthetic-photo'),
    previewData: 'data:image/jpeg;base64,c3ludGhldGlj',
    sections: [
      { id: 'section', text: 'Synthetic text', startOffset: 0, endOffset: 14 },
    ],
  };
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(photo),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn(),
  };
  await render(
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
    />,
  );
  await fireEvent.press(screen.getByTestId('records-import-medical-photo'));
  expect(
    screen.getByTestId('medical-document-review-original-photo'),
  ).toBeTruthy();
  expect(screen.getByText('Synthetic text')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('medical-document-save'));
  expect(service.saveDocument).toHaveBeenCalledWith(photo);
});

test('leaves import available when photo retrieval fails', async () => {
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockRejectedValue(new Error('Synthetic failure')),
    saveDocument: jest.fn(),
    discardDocument: jest.fn(),
  };
  await render(
    <RecordsRoute
      recordings={[]}
      recordingState="ready"
      onRetryRecordings={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
      onOpenRecording={jest.fn()}
      onOpenHealthLibrary={jest.fn()}
      onOpenManualHistory={jest.fn()}
      documentImportService={service}
    />,
  );
  await fireEvent.press(screen.getByTestId('records-import-medical-photo'));
  expect(
    screen.getByTestId('medical-document-import-status'),
  ).toHaveTextContent(t('medicalDocument.error.importFailed'));
  expect(screen.getByTestId('records-import-medical-photo')).toBeEnabled();
  expect(service.saveDocument).not.toHaveBeenCalled();
});
