import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from './AppSymbol';
import { appColors } from './appColors';

const tileSide = 48;
const actionWidth = 54;
const gap = 8;
export const swipeActionIconTileLaneWidth = actionWidth * 2 + gap * 3;

export interface SwipeActionIconTile {
  readonly label: string;
  readonly hint?: string;
  readonly symbol: string;
  readonly tone: 'primary' | 'destructive';
  readonly onPress: () => void;
  readonly testID: string;
}

/** A two-action lane fixes the visual order; the swipe host controls hit testing and accessibility. */
export function SwipeActionIconTiles({
  actions,
  testID,
}: {
  readonly actions: readonly [SwipeActionIconTile, SwipeActionIconTile];
  readonly testID: string;
}) {
  return (
    <View style={styles.lane} testID={testID}>
      {actions.map(
        ({ label, hint, symbol, tone, onPress, testID: actionId }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={hint}
            key={actionId}
            onPress={onPress}
            style={styles.action}
            testID={actionId}
          >
            <View
              style={[
                styles.tile,
                tone === 'primary' ? styles.primary : styles.destructive,
              ]}
            >
              <AppSymbol
                name={symbol}
                color={
                  tone === 'primary' ? appColors.onPrimary : appColors.onDanger
                }
                size={20}
              />
            </View>
          </Pressable>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    direction: 'ltr',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap,
    paddingHorizontal: gap,
  },
  action: { width: actionWidth, minHeight: 44, alignItems: 'center' },
  tile: {
    width: tileSide,
    height: tileSide,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: appColors.primaryAction },
  destructive: { backgroundColor: appColors.dangerAction },
});
