import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../../navigation/navigationGeometry';

function viewStyle(testID: string): ViewStyle {
  const style = screen.getByTestId(testID).props.style as StyleProp<ViewStyle>;
  return StyleSheet.flatten(style) ?? {};
}

/** Checks that production panel widths fit inside the full-height regions sent by UIKit. */
export function expectDuoPanelsInsideNativeRegions(
  layoutTestID: string,
  payload: NavigationGeometryPayload,
) {
  const snapshot = createNavigationGeometrySnapshot(payload);
  expect(snapshot).not.toBeNull();
  if (!snapshot) return;

  const regions = snapshot.usableRegions
    .filter(region => region.height >= snapshot.safeAreaFrame.height * 0.6)
    .sort((left, right) => left.x - right.x);
  expect(regions).toHaveLength(2);
  if (regions.length !== 2) return;
  const [left, right] = regions;
  if (!left || !right) return;

  const layout = viewStyle(layoutTestID);
  const primary = viewStyle(`${layoutTestID}-primary`);
  const secondary = viewStyle(`${layoutTestID}-secondary`);
  const primaryStart =
    snapshot.safeAreaFrame.x + Number(layout.marginStart ?? 0);
  const primaryEnd = primaryStart + Number(primary.width ?? 0);
  const secondaryStart = primaryEnd + Number(layout.columnGap ?? 0);
  const secondaryEnd = secondaryStart + Number(secondary.width ?? 0);

  expect(primaryStart).toBeGreaterThanOrEqual(left.x - 0.5);
  expect(primaryEnd).toBeLessThanOrEqual(left.x + left.width + 0.5);
  expect(secondaryStart).toBeGreaterThanOrEqual(right.x - 0.5);
  expect(secondaryEnd).toBeLessThanOrEqual(right.x + right.width + 0.5);
}
