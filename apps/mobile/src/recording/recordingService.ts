import { nativeRecordingBridge } from './nativeRecordingBridge';
import { saveRecordingSource } from './recordingPersistence';
import type { RecordingService } from './recordingTypes';

export const recordingService: RecordingService = {
  getState: () => nativeRecordingBridge.getState(),
  subscribe: listener => nativeRecordingBridge.subscribe(listener),
  start: consentAcknowledged => nativeRecordingBridge.start(consentAcknowledged),
  pause: () => nativeRecordingBridge.pause(),
  resume: () => nativeRecordingBridge.resume(),
  stop: () => nativeRecordingBridge.stop(),
  saveSource: recording => saveRecordingSource(recording),
};
