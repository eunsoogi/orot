import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';

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
  return (
    <View style={rightBleed ? { marginRight: -rightBleed } : undefined}>
      <ScrollView
        {...props}
        horizontal
        style={style}
        contentContainerStyle={[
          contentContainerStyle,
          rightBleed ? { paddingRight: rightBleed } : undefined,
        ]}
      />
      {touchClearance > 0 && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          collapsable={false}
          style={[styles.reserved, { width: touchClearance }]}
          testID="navigation-edge-menu-touch-clearance"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reserved: { position: 'absolute', top: 0, right: 0, bottom: 0 },
});
