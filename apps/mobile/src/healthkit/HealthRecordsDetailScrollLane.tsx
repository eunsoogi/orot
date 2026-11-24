import { useCallback, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { healthRecordsDetailStyles as styles } from './HealthRecordsDetailScreen.styles';

/** Measures the stable panel, not the widened list. Interior panels keep their own scroll edge. */
export function HealthRecordsDetailScrollLane({
  children,
}: {
  readonly children: (layout: {
    readonly edge: ReturnType<typeof useNavigationEdgeVerticalScroll>;
    readonly navigationInset: ReturnType<typeof useNavigationContentInset>;
  }) => ReactNode;
}) {
  const [ownerWidth, setOwnerWidth] = useState(0);
  const measure = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    setOwnerWidth(nativeEvent.layout.width);
  }, []);
  const navigationInset = useNavigationContentInset();
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth,
    trailingPadding:
      navigationInset.paddingRight ?? styles.container.paddingHorizontal,
  });

  return (
    <View
      onLayout={measure}
      style={styles.panelScroll}
      testID="health-records-detail-scroll-lane"
    >
      {children({ edge, navigationInset })}
    </View>
  );
}
