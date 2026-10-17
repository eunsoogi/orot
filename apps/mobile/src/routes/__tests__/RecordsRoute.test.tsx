import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordsRoute } from '../RecordsRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../recording/RecordingLibraryPanel', () => () => null);

test('keeps recording and imported records visible without manual import actions', async () => {
  const onOpenRecording = jest.fn();
  const onOpenHealthLibrary = jest.fn();
  await render(
    <RecordsRoute
      refreshKey="ready"
      recordingState="ready"
      onRetry={jest.fn()}
      onOpenRecording={onOpenRecording}
      onOpenHealthLibrary={onOpenHealthLibrary}
    />,
  );

  expect(screen.getByTestId('records-new-recording')).toHaveTextContent(
    '새 상담 녹음',
  );
  expect(screen.getByText('가져온 건강 기록', { exact: true })).toBeTruthy();
  expect(screen.queryByTestId('records-health-import')).toBeNull();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
  expect(onOpenRecording).toHaveBeenCalledTimes(1);
  expect(onOpenHealthLibrary).toHaveBeenCalledTimes(1);
});
