import { StyleSheet, View, useColorScheme } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** One non-interactive palette and light source for the Records home and its calendar. */
export function RecordsPageBackdrop() {
  const dark = useColorScheme() === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, dark ? styles.dark : styles.light]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="recordsGlow" cx="0%" cy="0%" rx="100%" ry="75%">
            <Stop offset="0%" stopColor={dark ? '#182B48' : '#E3EDF9'} />
            <Stop
              offset="100%"
              stopColor={dark ? '#182B48' : '#E3EDF9'}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#recordsGlow)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { backgroundColor: '#0B101A' },
  light: { backgroundColor: '#F8FAFD' },
});
