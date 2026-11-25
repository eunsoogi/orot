import { StyleSheet, View, type ViewStyle } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared visual only. Each caller owns and bounds the lifetime of its level readings. */
export function AudioLevelWaveform({
  active,
  levels,
  testID,
  maxBarHeight = 54,
  style,
}: {
  readonly active: boolean;
  readonly levels: readonly number[];
  readonly testID: string;
  readonly maxBarHeight?: number;
  readonly style?: ViewStyle;
}) {
  const opacity = active ? 1 : 0.4;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.waveform, style]}
      testID={testID}
    >
      {levels.map((level, index) => (
        <View
          key={index}
          testID={`${testID}-bar-${index}`}
          style={[
            styles.bar,
            { height: 3 + Math.sqrt(level) * (maxBarHeight - 3), opacity },
          ]}
        />
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  waveform: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: appColors.primary },
});
