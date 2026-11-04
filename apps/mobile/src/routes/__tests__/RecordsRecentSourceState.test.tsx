import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { RecordsRouteProps } from '../RecordsRoute';
import { RecordsRoute } from '../RecordsRoute';
import type { MedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function routeProps(
  overrides: Partial<RecordsRouteProps> = {},
): RecordsRouteProps {
  const service: MedicalDocumentImportService = {
    listDocuments: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  return {
    recordings: [],
    recordingState: 'ready',
    onRetryRecordings: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    documentImportService: service,
    ...overrides,
  };
}

test('shows and retries a failed imported-document list read', async () => {
  const listDocuments = jest
    .fn()
    .mockRejectedValueOnce(new Error('Local source read failed.'))
    .mockResolvedValue([]);
  const service: MedicalDocumentImportService = {
    listDocuments,
    getDocument: jest.fn().mockResolvedValue(null),
    selectDocument: jest.fn().mockResolvedValue(null),
    saveDocument: jest.fn().mockResolvedValue('saved'),
    discardDocument: jest.fn().mockResolvedValue(undefined),
  };
  const onRetryRecordings = jest.fn();
  await render(
    <RecordsRoute
      {...routeProps({
        documentImportService: service,
        onRetryRecordings,
      })}
    />,
  );

  expect(
    await screen.findByTestId('records-recent-sources-error'),
  ).toHaveTextContent('저장된 문서를 불러오지 못했어요.');
  await fireEvent.press(screen.getByTestId('records-recent-sources-retry'));
  await waitFor(() => {
    expect(screen.getByTestId('records-recent-sources-empty')).toBeTruthy();
  });
  expect(listDocuments).toHaveBeenCalledTimes(2);
  expect(onRetryRecordings).toHaveBeenCalledTimes(1);
});
