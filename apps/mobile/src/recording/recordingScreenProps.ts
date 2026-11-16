import type {
  RecordingPlaybackService,
  RecordingService,
} from './recordingTypes';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingLibraryService } from './recordingLibraryService';
import type { RecordingDeletionTimingProbe } from './recordingDeletionTiming';

export interface RecordingScreenProps {
  onBack: () => void;
  onOpenSavedRecordings?: () => void;
  service?: RecordingService;
  playbackService?: RecordingPlaybackService;
  /** Lets the Simulator probe exercise the production screen with synthetic playback evidence. */
  transcriptService?: TranscriptEvidenceService;
  recordingLibraryService?: RecordingLibraryService;
  /** Supplied only by the Simulator measurement harness; reports contain timing stages, not recording data. */
  recordingDeletionTimingProbe?: RecordingDeletionTimingProbe;
}
