import { formatDateTime, t } from '../i18n';
import { MaterialLibraryRow } from '../layout/MaterialLibraryRows';
import {
  SwipeActionIconTiles,
  swipeActionIconTileLaneWidth,
} from '../layout/SwipeActionIconTiles';
import { TrailingSwipeAction } from '../layout/TrailingSwipeAction';
import {
  manualHistoryEffectiveDateLabel,
  manualHistoryReviewLabel,
} from '../manualHistory/manualHistoryLabels';
import { isHistoryMemory, type SavedMemory } from './unifiedSavedMemories';
import { shareableSavedMemory } from './useSavedMemorySwipeActions';

export function SavedMemorySwipeRow({
  row,
  enabled,
  disabled,
  revealed,
  onReveal,
  divider,
  onShare,
  onDelete,
  onOpen,
}: {
  row: SavedMemory;
  enabled: boolean;
  disabled: boolean;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  divider: boolean;
  onShare: () => void;
  onDelete: () => void;
  onOpen?: () => void;
}) {
  const history = isHistoryMemory(row);
  const entry = (
    <MaterialLibraryRow
      testID={`saved-memory-entry-${row.id}`}
      divider={divider}
      title={row.text.replace(/\s+/g, ' ').trim()}
      titleNumberOfLines={2}
      summary={
        history
          ? manualHistoryEffectiveDateLabel(row.record.effectiveDate) +
            ' · ' +
            manualHistoryReviewLabel(row.record)
          : t('savedMemory.savedAt', {
              date: formatDateTime(new Date(row.createdAt)),
            })
      }
      accessibilityHint={t('savedMemory.openDetail')}
      onPress={onOpen}
    />
  );
  if (!enabled || !history || !shareableSavedMemory(row)) return entry;
  return (
    <TrailingSwipeAction
      action={
        <SwipeActionIconTiles
          testID={`saved-memory-swipe-actions-${row.id}`}
          actions={[
            {
              label: t('savedMemory.share'),
              symbol: 'square.and.arrow.up',
              tone: 'primary',
              onPress: onShare,
              testID: `saved-memory-share-${row.id}`,
            },
            {
              label: t('manualHistory.detail.delete'),
              symbol: 'trash',
              tone: 'destructive',
              onPress: onDelete,
              testID: `saved-memory-delete-${row.id}`,
            },
          ]}
        />
      }
      disabled={disabled}
      revealed={revealed}
      revealDuringDrag
      revealWidth={swipeActionIconTileLaneWidth}
      onRevealedChange={onReveal}
      testID={`saved-memory-swipe-${row.id}`}
    >
      {entry}
    </TrailingSwipeAction>
  );
}
