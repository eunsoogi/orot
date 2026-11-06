import { act, renderHook } from '@testing-library/react-native';
import { bindSelectedVisit } from '../bindSelectedVisit';
import { useRecordingVisitSelection } from '../useRecordingVisitSelection';

jest.mock('../bindSelectedVisit', () => ({ bindSelectedVisit: jest.fn() }));

it('updates selection after linking, and retains it if a later unlink fails', async () => {
  jest
    .mocked(bindSelectedVisit)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('disk'));
  const options = {
    recordingId: 'audio',
    sourceSaved: true,
    setBusy: jest.fn(),
    setError: jest.fn(),
    start: jest.fn(async () => {}),
    cancel: jest.fn(),
  };
  const { result } = await renderHook(() =>
    useRecordingVisitSelection(options),
  );
  await act(async () => {
    await result.current.selectVisit('visit');
  });
  expect(bindSelectedVisit).toHaveBeenCalledWith('audio', 'visit');
  expect(result.current.selectedVisit).toBe('visit');
  expect(options.start).toHaveBeenCalledWith('audio');
  await act(async () => {
    await result.current.selectVisit(null);
  });
  expect(result.current.selectedVisit).toBe('visit');
  expect(options.cancel).not.toHaveBeenCalled();
  expect(options.setError).toHaveBeenCalledWith(
    '녹음 상태를 처리하지 못했어요. 다시 시도해 주세요.',
  );
});

it('cancels a current transcription after an explicit successful unlink', async () => {
  jest.mocked(bindSelectedVisit).mockResolvedValue(undefined);
  const options = {
    recordingId: 'audio',
    sourceSaved: true,
    setBusy: jest.fn(),
    setError: jest.fn(),
    start: jest.fn(async () => {}),
    cancel: jest.fn(),
  };
  const { result } = await renderHook(() =>
    useRecordingVisitSelection(options),
  );
  await act(async () => {
    await result.current.selectVisit(null);
  });
  expect(bindSelectedVisit).toHaveBeenCalledWith('audio', null);
  expect(options.cancel).toHaveBeenCalledWith('audio');
});
