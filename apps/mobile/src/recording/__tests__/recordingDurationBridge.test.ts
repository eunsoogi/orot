import {
  nativeRecordingBridge,
  readSyntheticRecordingDuration,
} from '../nativeRecordingBridge';
import { requireNativeModule } from '../recordingNativeModule';

jest.mock('../recordingNativeModule', () => ({
  requireNativeModule: jest.fn(),
  getNativeRecordingModule: jest.fn(),
}));

test('production duration reads keep the protected-file boundary strict', async () => {
  const getRecordingDuration = jest.fn(async () => 2500);
  (requireNativeModule as jest.Mock).mockReturnValue({ getRecordingDuration });
  expect(await nativeRecordingBridge.readDuration('recording-id')).toBe(2500);
  expect(getRecordingDuration).toHaveBeenCalledWith('recording-id', false);
});

test('only the explicit synthetic adapter requests the Simulator metadata exception', async () => {
  const getRecordingDuration = jest.fn(async () => 2500);
  (requireNativeModule as jest.Mock).mockReturnValue({ getRecordingDuration });
  expect(await readSyntheticRecordingDuration('synthetic-id')).toBe(2500);
  expect(getRecordingDuration).toHaveBeenCalledWith('synthetic-id', true);
});
