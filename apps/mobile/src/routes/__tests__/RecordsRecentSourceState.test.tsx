import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  holdRecentTestPage,
  recentTestExecution,
} from '../testSupport/recentRecordsRouteTestSupport';
import type { RecordsRouteProps } from '../RecordsRoute';
import { RecordsRoute } from '../RecordsRoute';
import type { MedicalDocumentImportService } from '../../medicalDocuments/medicalDocumentImportService';

jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
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
  expect(onRetryRecordings).not.toHaveBeenCalled();
});

test('first paint waits for an unfocused Records cursor and only reports empty after settlement', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
  const read = jest.mocked(loadRecentMaterial);
  const pending = holdRecentTestPage<[]>();
  read.mockClear().mockReturnValue(pending.promise);
  const props = routeProps({ openReport: jest.fn() });
  // Native navigation may render the scene before useIsFocused becomes true.
  const view = await render(<RecordsRoute {...props} active={false} />);
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByTestId('records-recent-sources-empty')).toBeNull();
  expect(
    screen.getByRole('progressbar', { name: '최근 기록을 불러오는 중…' }),
  ).toBeTruthy();
  await view.rerender(<RecordsRoute {...props} active />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('records-recent-sources-empty')).toBeNull();
  await act(async () => pending.resolve([]));
  expect(screen.getByTestId('records-recent-sources-empty')).toBeTruthy();
  expect(screen.queryByTestId('records-recent-sources-loading')).toBeNull();
});
