import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  NavigationContentFrameContext,
  type NavigationContentFrame,
} from '../../navigation/navigationContentFrame';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';

const windowFrame = { x: 0, y: 0, width: 466, height: 678 };
const frame: NavigationContentFrame = {
  side: 'right',
  windowFrame,
  viewportFrame: windowFrame,
  availableContentFrame: { ...windowFrame, width: 382 },
  reservedRegions: [],
  navigationFrame: { x: 406, y: 174, width: 48, height: 270 },
};

test('lends the rail only to the full-width health library list and horizontal chip strip', async () => {
  await render(
    <NavigationContentFrameContext.Provider value={frame}>
      <HealthRecordsLibraryScreen
        loadObservations={async () => ({ records: [], nextCursor: null })}
        onBack={jest.fn()}
        onOpenHealthImport={jest.fn()}
        onOpenDetail={jest.fn()}
      />
    </NavigationContentFrameContext.Provider>,
  );
  const owner = screen.getByTestId('health-records-primary-scroll-host');
  await fireEvent(owner, 'layout', { nativeEvent: { layout: { width: 382 } } });
  const list = screen.getByTestId('health-records-scroll');
  const menu = screen.getByTestId('health-record-category-filter');
  expect(StyleSheet.flatten(list.props.style)).toMatchObject({
    marginRight: -84,
  });
  expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
    paddingRight: 104,
    paddingHorizontal: 20,
  });
  expect(list.props.scrollIndicatorInsets.right).toBe(0);
  expect(StyleSheet.flatten(menu.parent?.props.style)).toMatchObject({
    marginRight: -104,
  });
  expect(StyleSheet.flatten(menu.props.contentContainerStyle)).toMatchObject({
    paddingRight: 104,
  });

  await fireEvent(owner, 'layout', { nativeEvent: { layout: { width: 340 } } });
  expect(StyleSheet.flatten(list.props.style)?.marginRight).toBeUndefined();
  expect(
    StyleSheet.flatten(menu.parent?.props.style)?.marginRight,
  ).toBeUndefined();
});
