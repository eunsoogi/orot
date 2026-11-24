import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';
import { navigationPhysicalRightLayout } from './navigationEdgeScroll';

/** Explicitly opted-in strips can render through the rail lane without taking
 * rail touches. Terminal padding lets the last control settle left of the rail. */
export function NavigationEdgeMenuScrollView({
  rightBleed,
  touchClearance,
  style,
  contentContainerStyle,
  ...props
}: Omit<ScrollViewProps, 'horizontal'> & {
  readonly rightBleed: number;
  readonly touchClearance: number;
}) {
  const right = navigationPhysicalRightLayout(rightBleed, rightBleed);
  return (
    <View style={rightBleed ? right.scrollViewStyle : undefined}>
      <ScrollView
        {...props}
        horizontal
        style={style}
        contentContainerStyle={[
          contentContainerStyle,
          rightBleed ? right.contentStyle : undefined,
        ]}
      />
      {touchClearance > 0 && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          collapsable={false}
          style={[
            styles.reserved,
            right.shieldAnchor,
            { width: touchClearance },
          ]}
          testID="navigation-edge-menu-touch-clearance"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reserved: { position: 'absolute', top: 0, bottom: 0 },
});
