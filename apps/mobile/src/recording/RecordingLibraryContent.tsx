import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import RecordingLibraryList from './RecordingLibraryList';
import RecordingLibrarySelectionSummary from './RecordingLibrarySelectionSummary';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';

/** Keeps loading, empty, and selected content within measured native usable regions. */
export default function RecordingLibraryContent({
  disabled,
  loadError,
  loading,
  onDelete,
  onNewRecording,
  onOpen,
  recordings,
  selectionSummary,
}: {
  readonly disabled: boolean;
  readonly loadError: boolean;
  readonly loading: boolean;
  readonly onDelete: (source: RecordingSourceRecord) => void;
  readonly onNewRecording?: () => void;
  readonly onOpen: (id: string, autoPlay?: boolean) => void;
  readonly recordings: readonly RecordingLibrarySummary[];
  readonly selectionSummary?: RecordingLibrarySummary;
}) {
  const list = (
    <RecordingLibraryList
      onNewRecording={onNewRecording}
      recordings={recordings}
      loading={loading}
      loadError={loadError}
      disabled={disabled}
      onOpen={onOpen}
      onDelete={onDelete}
    />
  );

  return (
    <AdaptiveColumns
      primary={list}
      secondary={
        selectionSummary ? (
          <RecordingLibrarySelectionSummary summary={selectionSummary} />
        ) : undefined
      }
      testID="saved-recordings-layout"
    />
  );
}
