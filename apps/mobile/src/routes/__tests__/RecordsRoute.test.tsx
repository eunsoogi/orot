import { fireEvent, render, screen } from '@testing-library/react-native';
import { RecordsRoute } from '../RecordsRoute';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('keeps recording and imported records visible without manual import actions', async () => {
  const onOpenSymptoms = jest.fn();
  const onOpenRecording = jest.fn();
  const onOpenHealthLibrary = jest.fn();
  const onOpenManualHistory = jest.fn();
  const onOpenSavedRecordings = jest.fn();
  await render(
    <RecordsRoute
      onOpenSymptoms={onOpenSymptoms}
      onOpenSavedRecordings={onOpenSavedRecordings}
      onOpenRecording={onOpenRecording}
      onOpenHealthLibrary={onOpenHealthLibrary}
      onOpenManualHistory={onOpenManualHistory}
    />,
  );

  expect(screen.getByTestId('records-new-recording')).toHaveTextContent(
    '새 상담 녹음',
  );
  expect(screen.getByText('가져온 건강 기록', { exact: true })).toBeTruthy();
  expect(screen.queryByTestId('records-health-import')).toBeNull();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();
  expect(screen.queryByTestId('recording-library-panel')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-open-saved-recordings'));
  expect(onOpenSavedRecordings).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(onOpenSymptoms).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('records-new-recording'));
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
  await fireEvent.press(screen.getByTestId('records-open-manual-history'));
  expect(onOpenRecording).toHaveBeenCalledTimes(1);
  expect(onOpenHealthLibrary).toHaveBeenCalledTimes(1);
  expect(onOpenManualHistory).toHaveBeenCalledTimes(1);
  expect(screen.getByText('과거 건강 기록', { exact: true })).toBeTruthy();
});
