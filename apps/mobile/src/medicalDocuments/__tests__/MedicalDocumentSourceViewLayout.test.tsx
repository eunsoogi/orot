import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavigationGeometryProvider } from '../../navigation/NavigationGeometryProvider';
import { MedicalDocumentSourceView } from '../MedicalDocumentSourceView';
import {
  savedSourceDocument,
  sourceDetailCompactGeometry,
  sourceDetailDuoGeometry,
  sourceDetailNarrowSplitGeometry,
} from '../testSupport/medicalDocumentSourceViewFixtures';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number, fontScale = 1) => ({
  ...originalWindow,
  width,
  height: 900,
  scale: 1,
  fontScale,
});

function ParentViewport({ children }: { readonly children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={{ width, height }} testID="source-detail-test-viewport">
      {children}
    </View>
  );
}

async function renderMeasuredSource() {
  await render(
    <SafeAreaInsetsContext.Provider value={noInsets}>
      <NavigationGeometryProvider>
        <ParentViewport>
          <MedicalDocumentSourceView
            document={savedSourceDocument()}
            onBack={jest.fn()}
          />
        </ParentViewport>
      </NavigationGeometryProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  Dimensions.set({ window: viewport(1000), screen: viewport(1000) });
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      if (this.props.testID === 'medical-document-source-detail-layout-host') {
        const parent = Dimensions.get('window');
        callback(0, 0, parent.width, parent.height);
      }
    });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

test('uses measured Duo regions and preserves the detail while narrow and large-text layouts collapse', async () => {
  await renderMeasuredSource();
  const layout = () =>
    screen.getByTestId('medical-document-source-detail-layout');
  const direction = () =>
    StyleSheet.flatten(layout().props.style)?.flexDirection;
  const panelWidth = (side: 'primary' | 'secondary') =>
    StyleSheet.flatten(
      screen.getByTestId('medical-document-source-detail-layout-' + side).props
        .style,
    )?.width as number;

  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: sourceDetailDuoGeometry },
  );
  expect(direction()).toBe('column');
  const rootStyle = StyleSheet.flatten(layout().props.style);
  const primaryEnd =
    Number(rootStyle?.marginStart ?? 0) + panelWidth('primary');
  expect(primaryEnd).toBeLessThanOrEqual(450);
  expect(
    screen.queryByTestId('medical-document-source-detail-layout-secondary'),
  ).toBeNull();
  expect(
    screen.getByTestId('medical-document-source-text-0'),
  ).toHaveTextContent('Synthetic saved page text');

  await act(async () => {
    Dimensions.set({
      window: viewport(1000, 1.5),
      screen: viewport(1000, 1.5),
    });
  });
  expect(direction()).toBe('column');
  expect(
    screen.getByTestId('medical-document-source-text-0'),
  ).toHaveTextContent('Synthetic saved page text');

  await act(async () => {
    Dimensions.set({ window: viewport(620), screen: viewport(620) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: sourceDetailNarrowSplitGeometry },
    );
  });
  expect(direction()).toBe('column');
  expect(panelWidth('primary')).toBeLessThanOrEqual(280);
  expect(
    screen.getByTestId('medical-document-source-text-1'),
  ).toHaveTextContent('Synthetic range text');

  await act(async () => {
    Dimensions.set({ window: viewport(320), screen: viewport(320) });
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: sourceDetailCompactGeometry },
    );
  });
  expect(direction()).toBe('column');
  expect(panelWidth('primary')).toBeLessThanOrEqual(320);
  await fireEvent.press(screen.getByTestId('medical-document-source-back'));
});
