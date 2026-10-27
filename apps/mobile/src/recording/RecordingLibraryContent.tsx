import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import RecordingLibraryList from './RecordingLibraryList';
import RecordingLibrarySelectionSummary from './RecordingLibrarySelectionSummary';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';

/** Keeps the selection summary on the same measured axis as its source list. */
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

  return selectionSummary ? (
    <AdaptiveColumns
      primary={list}
      secondary={
        <RecordingLibrarySelectionSummary summary={selectionSummary} />
      }
      testID="saved-recordings-layout"
    />
  ) : (
    list
  );
}
