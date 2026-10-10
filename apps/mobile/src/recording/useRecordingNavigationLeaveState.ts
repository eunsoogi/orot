import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import type { RecordingStatus } from './recordingTypes';

const statusRevision: Readonly<Record<RecordingStatus, number>> = {
  idle: 0,
  recording: 1,
  paused: 2,
  interrupted: 3,
  completed: 4,
};

export function useRecordingNavigationLeaveState({
  status,
  stateReady,
  busy,
  sourceRetryPending,
  stopRecording,
}: {
  status: RecordingStatus;
  stateReady: boolean;
  busy: boolean;
  sourceRetryPending: boolean;
  stopRecording: () => Promise<void>;
}) {
  const canLeave = stateReady && !busy && !sourceRetryPending;
  const hasSharedNavigation = useNavigationLeaveStateRegistration(
    {
      canLeave,
      hasUnsavedChanges: sourceRetryPending,
      isRecording:
        status === 'recording' ||
        status === 'paused' ||
        status === 'interrupted',
      hasOngoingOperation: false,
      revision:
        statusRevision[status] +
        Number(stateReady) * 8 +
        Number(busy) * 16 +
        Number(sourceRetryPending) * 32,
      inputRevision: Number(sourceRetryPending),
    } satisfies NavigationLeaveState,
    stopRecording,
  );

  return { canLeave, hasSharedNavigation };
}
