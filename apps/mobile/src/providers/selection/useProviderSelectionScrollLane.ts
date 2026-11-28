import { settingsPageInsets } from '../../layout/settingsPagePresentation';
import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useNavigationEdgeVerticalScroll } from '../../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { providerSelectionScreenStyles as styles } from './providerSelectionScreenPresentation';

/** Only the measured Settings route owns the rail lane. An embedded feature
 * can share its route key without acquiring any additional scroll region. */
export function useProviderSelectionScrollLane(
  ownsRouteLane: boolean,
  isSettings: boolean,
) {
  const navigationInset = useNavigationContentInset();
  const inset = isSettings
    ? settingsPageInsets(navigationInset)
    : navigationInset;
  const [width, setWidth] = useState(0);
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth: ownsRouteLane ? width : 0,
    trailingPadding: inset.paddingRight ?? styles.container.padding,
  });
  return {
    edge,
    contentStyle: [
      isSettings ? styles.settingsContainer : styles.container,
      inset,
      edge.contentStyle,
    ],
    onLayout: (event: LayoutChangeEvent) =>
      setWidth(event.nativeEvent.layout.width),
  };
}
