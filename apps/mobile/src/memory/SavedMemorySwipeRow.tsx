import { formatDateTime, t } from '../i18n';
import { MaterialLibraryRow } from '../layout/MaterialLibraryRows';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { TrailingSwipeAction } from '../layout/TrailingSwipeAction';
import {
  manualHistoryEffectiveDateLabel,
  manualHistoryReviewLabel,
} from '../manualHistory/manualHistoryLabels';
import { isHistoryMemory, type SavedMemory } from './unifiedSavedMemories';

export function SavedMemorySwipeRow({
  row,
  enabled,
  disabled,
  revealed,
  onReveal,
  divider,
  onDelete,
  onOpen,
}: {
  row: SavedMemory;
  enabled: boolean;
  disabled: boolean;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  divider: boolean;
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
  if (!enabled || !history) return entry;
  return (
    <TrailingSwipeAction
      action={
        <View style={styles.lane}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('manualHistory.detail.delete')}
            onPress={onDelete}
            style={styles.tile}
            testID={`saved-memory-delete-${row.id}`}
          >
            <AppSymbol name="trash" color={appColors.onDanger} size={20} />
          </Pressable>
        </View>
      }
      disabled={disabled}
      revealed={revealed}
      revealDuringDrag
      revealWidth={64}
      onRevealedChange={onReveal}
      testID={`saved-memory-swipe-${row.id}`}
    >
      {entry}
    </TrailingSwipeAction>
  );
}

const styles = StyleSheet.create({
  lane: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.dangerAction,
  },
});
