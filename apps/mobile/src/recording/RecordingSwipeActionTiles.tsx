import { SwipeActionIconTiles } from '../layout/SwipeActionIconTiles';
import { t } from '../i18n';

/** Keeps recording-localized actions and stable identifiers on the shared swipe lane. */
export function RecordingSwipeActionTiles({
  sourceId,
  onShare,
  onDelete,
}: {
  readonly sourceId: string;
  readonly onShare: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <SwipeActionIconTiles
      testID={`recording-delete-slot-${sourceId}`}
      actions={[
        {
          label: t('recording.library.share'),
          hint: t('recording.export.audioHint'),
          symbol: 'square.and.arrow.up',
          tone: 'primary',
          onPress: onShare,
          testID: `recording-share-${sourceId}`,
        },
        {
          label: t('recording.library.delete'),
          symbol: 'trash',
          tone: 'destructive',
          onPress: onDelete,
          testID: `recording-delete-${sourceId}`,
        },
      ]}
    />
  );
}
