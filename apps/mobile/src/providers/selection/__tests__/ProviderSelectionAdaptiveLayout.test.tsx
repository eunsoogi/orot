import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { NavigationGeometryProvider } from '../../../navigation/NavigationGeometryProvider';
import type { NavigationGeometryPayload } from '../../../navigation/navigationGeometry';
import ProviderSelectionScreen from '../ProviderSelectionScreen';
import { createAppleSelectionOption } from '../options';
import { providerSelectionText } from '../text';
import type { ProviderSelectionOption, ProviderSelectionStore } from '../types';

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
const hostBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const featurePanelsID = 'provider-selection-feature-panels';
const hostID = `${featurePanelsID}-host`;
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const local = createAppleSelectionOption('available');
const remote: ProviderSelectionOption = {
  ...local,
  provider: {
    ...local.provider,
    id: 'chatgpt-plan:synthetic-account:gpt-synthetic',
    displayName: 'ChatGPT',
  },
  modelId: 'gpt-synthetic',
  displayName: 'ChatGPT',
  privacyBoundary: 'selected-context-remote',
};
const limited: ProviderSelectionOption = {
  ...remote,
  provider: {
    ...remote.provider,
    id: 'chatgpt-plan:synthetic-account:limited-model',
    displayName: 'Limited model',
    capabilities: { ...remote.provider.capabilities, toolCalling: false },
  },
  modelId: 'limited-model',
  displayName: 'Limited model',
};
const options = [local, remote, limited];
const requirements = { inputTypes: ['text'] as const, toolCalling: true };

beforeEach(() => {
  hostBounds.clear();
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const bounds = hostBounds.get(this.props.testID ?? '');
      if (bounds) callback(bounds.x, 0, bounds.width, 800);
    });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await act(() => Dimensions.set(originalDimensions));
});

// Keep native window width separate from the route's measured content host.
function viewport(width: number, fontScale: number) {
  const window = { ...originalDimensions.window, width, fontScale };
  const nativeScreen = { ...originalDimensions.screen, width, fontScale };
  return { window, screen: nativeScreen };
}

// The fixture reserves the hinge and right navigation lane as actual geometry.
function duoGeometry(
  width: number,
  divisionX: number,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 800 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'division',
        kind: 'division',
        frame: { x: divisionX, y: 0, width: 20, height: 800 },
        margins: noInsets,
        isActive: true,
      },
      {
        id: 'right-navigation-lane',
        kind: 'occlusion',
        frame: { x: width - 60, y: 0, width: 60, height: 800 },
        margins: noInsets,
        isActive: true,
      },
    ],
  };
}

function panelAxis(): string | undefined {
  return StyleSheet.flatten(screen.getByTestId(featurePanelsID).props.style)
    ?.flexDirection;
}

// Constrain the measured host to the same parent that owns the production screen.
function measureWithinParent(parentWidth: number) {
  const x = 20;
  const width = Math.max(0, parentWidth - x * 2);
  hostBounds.set(hostID, { x, width });
  expect(x + width).toBeLessThanOrEqual(parentWidth);
  return fireEvent(screen.getByTestId(hostID), 'layout', {
    nativeEvent: { layout: { width, height: 800, x: 0, y: 0 } },
  });
}

// Exercise the production screen through both Duo and narrow, large-text regions.
test('reflows in measured Duo regions while preserving a pending choice and confirmation', async () => {
  const store: ProviderSelectionStore = {
    load: async () => null,
    save: jest.fn(async () => undefined),
    clear: async () => undefined,
  };
  const onSelectionCommitted = jest.fn();
  await act(() => Dimensions.set(viewport(1700, 1)));

  const screenForParent = (parentWidth: number) => (
    <NavigationGeometryProvider>
      <View style={{ width: parentWidth }}>
        <ProviderSelectionScreen
          options={options}
          requirements={requirements}
          selectionStore={store}
          onSelectionCommitted={onSelectionCommitted}
        />
      </View>
    </NavigationGeometryProvider>
  );
  const { rerender } = await render(screenForParent(1400));
  await waitFor(() =>
    expect(screen.getByTestId('provider-option-1')).toBeTruthy(),
  );

  await measureWithinParent(1400);
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: duoGeometry(1700, 700) },
  );

  expect(panelAxis()).toBe('row');
  expect(
    screen.getByTestId('provider-option-0-capabilities'),
  ).toHaveTextContent(
    `${providerSelectionText.capabilitiesSummary}: ${[
      providerSelectionText.capabilityInput.text,
      providerSelectionText.capabilityStreaming,
      providerSelectionText.capabilityStructuredOutput,
      providerSelectionText.capabilityToolCalling,
    ].join(' · ')}`,
  );
  expect(
    screen.getByTestId('provider-option-2').props.accessibilityState.disabled,
  ).toBe(true);
  expect(
    screen.getByText(providerSelectionText.unsupportedCapabilities),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('provider-option-1'));
  expect(store.save).not.toHaveBeenCalled();
  expect(
    screen.getByTestId('provider-option-1').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByTestId('provider-selection-confirm')).toBeTruthy();

  hostBounds.set(hostID, { x: 20, width: 580 });
  await act(() => Dimensions.set(viewport(900, 1.5)));
  await rerender(screenForParent(620));
  await measureWithinParent(620);
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: duoGeometry(900, 300) },
  );

  expect(panelAxis()).toBe('column');
  expect(
    screen.getByTestId('provider-option-1').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByTestId('provider-selection-confirm')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('provider-selection-confirm'));
  await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
  expect(onSelectionCommitted).toHaveBeenCalledWith(
    { providerId: remote.provider.id, modelId: remote.modelId },
    remote.provider,
  );
});
