import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

const tileSide = 48;
const actionWidth = 54;
const gap = 8;
export const recordingSwipeTileLaneWidth = actionWidth * 2 + gap * 3;

/** The transparent exposed lane holds two independent controls, not one colored action behind the card. */
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
    <View style={styles.lane} testID={`recording-delete-slot-${sourceId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('recording.library.share')}
        accessibilityHint={t('recording.export.audioHint')}
        onPress={onShare}
        style={styles.action}
        testID={`recording-share-${sourceId}`}
      >
        <View style={[styles.tile, styles.share]}>
          <AppSymbol
            name="square.and.arrow.up"
            color={appColors.onPrimary}
            size={20}
          />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('recording.library.delete')}
        onPress={onDelete}
        style={styles.action}
        testID={`recording-delete-${sourceId}`}
      >
        <View style={[styles.tile, styles.delete]}>
          <AppSymbol name="trash" color={appColors.onDanger} size={20} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap,
    paddingHorizontal: gap,
  },
  action: { width: actionWidth, minHeight: 44, alignItems: 'center', gap: 4 },
  tile: {
    width: tileSide,
    height: tileSide,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  share: { backgroundColor: appColors.primaryAction },
  delete: { backgroundColor: appColors.dangerAction },
});
