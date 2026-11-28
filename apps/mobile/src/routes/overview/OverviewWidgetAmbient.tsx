import { StyleSheet, View, useColorScheme } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Decorative light stays behind the widget stack and never receives input. */
export function OverviewWidgetAmbient() {
  const dark = useColorScheme() === 'dark';
  const strength = dark ? 0.26 : 0.17;
  return (
    <View
      style={styles.ambient}
      testID="overview-widget-ambient"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 400 700"
      >
        <Defs>
          <RadialGradient
            id="overview-widget-ambient-blue"
            cx="36%"
            cy="23%"
            rx="72%"
            ry="48%"
          >
            <Stop
              offset="0"
              stopColor={dark ? '#4356a8' : '#b3c7fa'}
              stopOpacity={strength}
            />
            <Stop
              offset="0.58"
              stopColor={dark ? '#4356a8' : '#b3c7fa'}
              stopOpacity={strength * 0.7}
            />
            <Stop
              offset="1"
              stopColor={dark ? '#4356a8' : '#b3c7fa'}
              stopOpacity={0}
            />
          </RadialGradient>
          <RadialGradient
            id="overview-widget-ambient-plum"
            cx="65%"
            cy="58%"
            rx="75%"
            ry="50%"
          >
            <Stop
              offset="0"
              stopColor={dark ? '#9d4274' : '#edb6d7'}
              stopOpacity={strength}
            />
            <Stop
              offset="0.62"
              stopColor={dark ? '#9d4274' : '#edb6d7'}
              stopOpacity={strength * 0.7}
            />
            <Stop
              offset="1"
              stopColor={dark ? '#9d4274' : '#edb6d7'}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>
        <Rect
          width="400"
          height="700"
          fill="url(#overview-widget-ambient-blue)"
        />
        <Rect
          width="400"
          height="700"
          fill="url(#overview-widget-ambient-plum)"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ambient: {
    position: 'absolute',
    left: -18,
    right: -18,
    top: -12,
    bottom: -16,
  },
});
