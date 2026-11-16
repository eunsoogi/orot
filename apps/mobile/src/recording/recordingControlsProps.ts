import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingLibraryService } from './recordingLibraryService';
import type {
  CompletedRecording,
  RecordingPlaybackService,
  RecordingStatus,
} from './recordingTypes';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

export interface RecordingControlsProps {
  selectedVisit?: string | null;
  onSelectVisit?: (id: string | null) => void;
  onBack: () => void;
  onOpenSavedRecordings?: () => void;
  stateReady: boolean;
  status: RecordingStatus;
  durationMs: number;
  amplitude?: number;
  consentAcknowledged: boolean;
  onToggleConsent: () => void;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<void>;
  lastRecording: CompletedRecording | null;
  sourceSaved: boolean;
  onRetrySourceSave: () => void;
  error: string;
  syntheticProbeAvailable: boolean;
  syntheticProbeReady: boolean;
  onPrepareSyntheticProbe: () => void;
  onPrepareSyntheticStartFailure: (
    point: 'beforeFileURL' | 'afterFileCreated',
  ) => void;
  onSendInterruption: (phase: 'began' | 'ended') => void;
  probeError: string;
  transcriptService?: TranscriptEvidenceService;
  automaticTranscription?: AutomaticTranscriptionSnapshot | null;
  onRetryTranscription?: () => void;
  recordingLibraryService?: RecordingLibraryService;
  playbackService?: RecordingPlaybackService;
  onRecordingSourceDeleted?: (sourceId: string) => void;
}
