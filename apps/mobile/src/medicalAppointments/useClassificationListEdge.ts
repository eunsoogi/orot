import {
  navigationPhysicalRightLayout,
  useNavigationEdgeVerticalScroll,
} from '../navigation/navigationEdgeScroll';
import { useNavigationRightScrollEdge } from '../navigation/navigationScrollEdge';

/** Extends the native viewport beyond the feature's own trailing gutter.
 * Keep the existing result/confirmation/detail frames and row widths intact. */
export function useClassificationListEdge(
  ownerWidth: number,
  featureGutter: number,
) {
  const edge = useNavigationEdgeVerticalScroll({ ownerWidth });
  const geometry = useNavigationRightScrollEdge();
  return {
    ...edge,
    ...(edge.scrollViewStyle
      ? navigationPhysicalRightLayout(
          geometry.right + featureGutter,
          geometry.right + featureGutter,
        )
      : {}),
  };
}
