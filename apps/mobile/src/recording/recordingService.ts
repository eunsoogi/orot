import { nativeRecordingBridge } from './nativeRecordingBridge';
import { saveRecordingSource } from './recordingPersistence';
import type { RecordingService } from './recordingTypes';

export const recordingService: RecordingService = {
  readDuration: recordingId => nativeRecordingBridge.readDuration(recordingId),
  getState: () => nativeRecordingBridge.getState(),
  subscribe: listener => nativeRecordingBridge.subscribe(listener),
  start: consentAcknowledged =>
    nativeRecordingBridge.start(consentAcknowledged),
  pause: () => nativeRecordingBridge.pause(),
  resume: () => nativeRecordingBridge.resume(),
  stop: () => nativeRecordingBridge.stop(),
  playRange: (recordingId, startMs, endMs) =>
    nativeRecordingBridge.playRange(recordingId, startMs, endMs),
  stopPlayback: () => nativeRecordingBridge.stopPlayback(),
  subscribePlayback: listener =>
    nativeRecordingBridge.subscribePlayback(listener),
  saveSource: recording => saveRecordingSource(recording),
};
