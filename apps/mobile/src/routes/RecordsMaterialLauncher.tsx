import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

interface RecordsMaterialDestination {
  readonly icon: string;
  readonly iconBackground: string;
  readonly title: string;
  readonly hint?: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly testID: string;
}

const defaultColumns = [0, 1, 2] as const;
const largeTextColumns = [0] as const;

/** Only My Materials uses this launcher; source import and the timeline keep their own presentations. */
export function RecordsMaterialLauncher({
  items,
  largeText,
}: {
  readonly items: readonly RecordsMaterialDestination[];
  readonly largeText: boolean;
}) {
  // Keep the existing large-text escape hatch without collapsing narrow regular-type screens.
  const columns = largeText ? largeTextColumns : defaultColumns;
  const columnCount = columns.length;
  const rowCount = Math.ceil(items.length / columnCount);
  return (
    <View style={styles.surface} testID="records-material-directory">
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <View
          key={rowIndex}
          style={styles.row}
          testID="records-material-launcher-row"
        >
          {columns.map(columnIndex => {
            const item = items[rowIndex * columnCount + columnIndex];
            // Empty slots reserve alignment on the last row, without adding a focus target.
            if (!item) {
              return <View key={columnIndex} style={styles.slot} />;
            }
            const disabled = item.disabled === true || !item.onPress;
            return (
              <Pressable
                key={item.testID}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                accessibilityHint={item.hint}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.slot,
                  styles.button,
                  largeText && styles.largeTextButton,
                  (disabled || pressed) && styles.quiet,
                ]}
                testID={item.testID}
              >
                <View
                  accessible={false}
                  style={[
                    styles.icon,
                    { backgroundColor: item.iconBackground },
                  ]}
                  testID="records-material-launcher-icon"
                >
                  <AppSymbol
                    name={item.icon}
                    color={appColors.onPrimary}
                    size={24}
                  />
                </View>
                <Text
                  style={[styles.label, largeText && styles.largeTextLabel]}
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    gap: 16,
    paddingHorizontal: 8,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: appColors.surface,
  },
  row: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  slot: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  button: {
    minHeight: 56,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  largeTextButton: { flexDirection: 'row', gap: 10 },
  quiet: { opacity: 0.65 },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  label: {
    alignSelf: 'stretch',
    minWidth: 0,
    paddingHorizontal: 2,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  largeTextLabel: { flex: 1, alignSelf: 'center', textAlign: 'auto' },
});
