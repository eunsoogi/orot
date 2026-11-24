import { useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';
import { useNavigationEdgeVerticalScroll } from '../../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';

interface EvidenceRouteLane {
  readonly width: number;
  readonly leftGutter: number;
  readonly rightGutter: number;
}

/** The production route may borrow the rail; a nested or standalone reader
 * cannot. Measure outside the compensated native scroll view. */
export function EvidenceRouteScrollView({
  routeKey,
  routeGutter = 20,
  children,
  style,
  contentContainerStyle,
  ...props
}: Omit<ScrollViewProps, 'children'> & {
  readonly routeKey?: string;
  readonly routeGutter?: number;
  readonly children: ReactNode | ((lane: EvidenceRouteLane) => ReactNode);
}) {
  const [width, setWidth] = useState(0);
  const inset = useNavigationContentInset();
  const lane = {
    width: routeKey ? width : 0,
    leftGutter: inset.paddingLeft ?? routeGutter,
    rightGutter: inset.paddingRight ?? routeGutter,
  };
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth: lane.width,
    trailingPadding: lane.rightGutter,
  });
  return (
    <View
      style={styles.fill}
      testID={props.testID ? `${props.testID}-owner` : undefined}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        {...props}
        {...edge.indicatorProps}
        style={[style, edge.scrollViewStyle]}
        contentContainerStyle={[
          contentContainerStyle,
          inset,
          edge.contentStyle,
        ]}
      >
        {typeof children === 'function' ? children(lane) : children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 } });
