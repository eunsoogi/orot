import { useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useNavigationEdgeVerticalScroll } from './navigationEdgeScroll';
import { useNavigationContentInset } from './useNavigationContentInset';

/** Owners inside adaptive lanes must measure the stable host, not the widened scroll. */
export function MeasuredRouteScrollView({
  children,
  testID,
  style,
  contentStyle,
  trailingGutter = 0,
}: {
  readonly children: ReactNode;
  readonly testID: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly trailingGutter?: number;
}) {
  const inset = useNavigationContentInset();
  const [ownerWidth, setOwnerWidth] = useState(0);
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth,
    trailingPadding: inset.paddingRight ?? trailingGutter,
  });
  return (
    <View
      onLayout={event => setOwnerWidth(event.nativeEvent.layout.width)}
      style={styles.fill}
      testID={testID + '-host'}
    >
      <ScrollView
        {...edge.indicatorProps}
        contentContainerStyle={[contentStyle, inset, edge.contentStyle]}
        style={[style, edge.scrollViewStyle]}
        testID={testID}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 } });
