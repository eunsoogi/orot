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

/** Checks the one-page owner stays inside one native region and never spans a seam. */
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

  const layout = viewStyle(layoutTestID);
  const primary = viewStyle(`${layoutTestID}-primary`);
  const start = snapshot.safeAreaFrame.x + Number(layout.marginStart ?? 0);
  const end = start + Number(primary.width ?? 0);
  expect(screen.queryByTestId(`${layoutTestID}-secondary`)).toBeNull();
  expect(
    regions.some(
      region => start >= region.x - 0.5 && end <= region.x + region.width + 0.5,
    ),
  ).toBe(true);
}
