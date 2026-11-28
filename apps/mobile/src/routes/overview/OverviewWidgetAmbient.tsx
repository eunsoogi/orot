import { I18nManager, StyleSheet, View, useColorScheme } from 'react-native';
import Svg, {
  Defs,
  G,
  LinearGradient,
  Mask,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { pageHeadingHorizontalInset } from '../../layout/pageHeadingPresentation';
import { useNavigationRightScrollEdge } from '../../navigation/navigationScrollEdge';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';

/** Decorative light stays behind the widget stack and never receives input. */
export function OverviewWidgetAmbient() {
  const dark = useColorScheme() === 'dark';
  const strength = dark ? 0.26 : 0.17;
  const { right } = useNavigationRightScrollEdge();
  const contentInset = useNavigationContentInset();
  // The shared scroller already paints under the physical right rail. Extend only this
  // decorative grid layer into that viewport, without changing card or control geometry.
  const bleed = right
    ? right + (contentInset.paddingRight ?? 0) + pageHeadingHorizontalInset
    : 18;
  const horizontalBounds = I18nManager.isRTL
    ? { start: -bleed, end: -18 }
    : { left: -18, right: -bleed };
  return (
    <View
      style={[styles.ambient, horizontalBounds]}
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
          {/* Feather the section boundaries instead of exposing the SVG's hard viewport edge. */}
          <LinearGradient
            id="overview-widget-ambient-vertical"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <Stop offset="0" stopColor="white" stopOpacity={0} />
            <Stop offset="0.12" stopColor="white" stopOpacity={1} />
            <Stop offset="0.86" stopColor="white" stopOpacity={1} />
            <Stop offset="1" stopColor="white" stopOpacity={0} />
          </LinearGradient>
          <Mask
            id="overview-widget-ambient-mask"
            x="0"
            y="0"
            width="400"
            height="700"
            maskUnits="userSpaceOnUse"
          >
            <Rect
              width="400"
              height="700"
              fill="url(#overview-widget-ambient-vertical)"
            />
          </Mask>
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
        <G mask="url(#overview-widget-ambient-mask)">
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
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ambient: {
    position: 'absolute',
    top: -12,
    bottom: -16,
  },
});
