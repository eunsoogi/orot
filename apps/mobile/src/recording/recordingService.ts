import { nativeRecordingBridge } from './nativeRecordingBridge';
import { createRecordingPlaybackOwner } from './recordingPlaybackOwner';
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
  ...createRecordingPlaybackOwner(nativeRecordingBridge),
  subscribePlayback: listener =>
    nativeRecordingBridge.subscribePlayback(listener),
  saveSource: recording => saveRecordingSource(recording),
};
