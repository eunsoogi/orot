import { VerticalPageSections as AdaptiveColumns } from '../layout/VerticalPageSections';
import RecordingLibraryList from './RecordingLibraryList';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';

/** Keeps loading, empty, and list content within measured native usable regions. */
export default function RecordingLibraryContent({
  disabled,
  loadError,
  loading,
  onDelete,
  onNewRecording,
  onOpen,
  onRetry,
  onShare,
  recordings,
}: {
  readonly disabled: boolean;
  readonly loadError: boolean;
  readonly loading: boolean;
  readonly onDelete: (source: RecordingSourceRecord) => void;
  readonly onNewRecording?: () => void;
  readonly onOpen: (id: string, autoPlay?: boolean) => void;
  readonly onShare?: (id: string) => void;
  readonly onRetry: () => void;
  readonly recordings: readonly RecordingLibrarySummary[];
}) {
  const list = (
    <RecordingLibraryList
      onNewRecording={onNewRecording}
      recordings={recordings}
      loading={loading}
      loadError={loadError}
      disabled={disabled}
      onOpen={onOpen}
      onRetry={onRetry}
      onShare={onShare}
      onDelete={onDelete}
    />
  );

  return <AdaptiveColumns primary={list} testID="saved-recordings-layout" />;
}
