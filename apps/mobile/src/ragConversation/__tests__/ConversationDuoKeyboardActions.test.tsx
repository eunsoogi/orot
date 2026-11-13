import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Dimensions, Keyboard } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { AiFeatureRoute } from '../../aiFeatures/integration/AiFeatureRoute';
import {
  apple,
  localData,
  selectionStore,
} from '../../aiFeatures/integration/featureServiceFixtures';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const originalWindow = Dimensions.get('window');
afterEach(() => Dimensions.set({ window: originalWindow }));

test('keeps Duo actions contextual when its small window requires bottom navigation', async () => {
  Dimensions.set({
    window: { ...originalWindow, width: 320, height: 720, fontScale: 1 },
  });
  await render(
    <AiFeatureRoute
      initialRoute="rag-conversation"
      onBack={jest.fn()}
      serviceDependencies={{
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => localData([]).data,
      }}
    />,
  );
  const geometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 320, height: 720 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: true,
    hasHinge: true,
    reservedRegions: [
      {
        id: 'hinge',
        kind: 'division',
        frame: { x: 315, y: 0, width: 5, height: 720 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        isActive: false,
      },
    ],
  };
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: geometry },
  );
  expect(screen.queryByTestId('navigation-right-rail-host')).toBeNull();
  const dock = screen.getByTestId('navigation-page-action-surface');
  expect(
    within(dock).getByTestId('rag-conversation-sessions-toggle'),
  ).toBeTruthy();
  expect(within(dock).getByTestId('rag-conversation-new-session')).toBeTruthy();
  expect(
    screen.getAllByTestId('rag-conversation-sessions-toggle'),
  ).toHaveLength(1);
  expect(screen.getAllByTestId('rag-conversation-new-session')).toHaveLength(1);
  expect(screen.queryByTestId('rag-conversation-history-glass')).toBeNull();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'draft',
  );
  await fireEvent.press(
    within(dock).getByTestId('rag-conversation-new-session'),
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
});

test('keeps Duo conversation actions in navigation when the keyboard moves the rail to the bottom', async () => {
  let showKeyboard: ((event: KeyboardEvent) => void) | undefined;
  const listener = jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((name, callback) => {
      if (name === 'keyboardDidShow') showKeyboard = callback;
      return { remove: jest.fn() };
    });
  try {
    Dimensions.set({
      window: { ...originalWindow, width: 1400, height: 900, fontScale: 1 },
    });
    await render(
      <AiFeatureRoute
        initialRoute="rag-conversation"
        onBack={jest.fn()}
        serviceDependencies={{
          selectedAi: {
            selectionStore: selectionStore({
              providerId: apple.provider.id,
              modelId: apple.modelId,
            }),
            loadAppleOption: async () => apple,
          },
          loadLocalData: async () => localData([]).data,
        }}
      />,
    );
    const geometry: NavigationGeometryPayload = {
      windowBounds: { x: 0, y: 0, width: 1400, height: 900 },
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      reservedRegionsSupported: true,
      reservedRegions: [
        {
          id: 'hinge',
          kind: 'division',
          frame: { x: 640, y: 0, width: 120, height: 900 },
          margins: { top: 0, right: 0, bottom: 0, left: 0 },
          isActive: true,
        },
      ],
    };
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      { nativeEvent: geometry },
    );
    await waitFor(() =>
      expect(screen.getByTestId('navigation-right-rail-host')).toBeTruthy(),
    );
    expect(showKeyboard).toBeDefined();
    await act(async () =>
      showKeyboard?.({ endCoordinates: { height: 850 } } as KeyboardEvent),
    );
    await fireEvent(
      screen.getByTestId('navigation-window-geometry-sensor'),
      'geometryChange',
      {
        nativeEvent: {
          ...geometry,
          navigationSide: 'bottom',
          navigationFrame: { x: 0, y: 0, width: 640, height: 60 },
        },
      },
    );
    await waitFor(() =>
      expect(screen.queryByTestId('navigation-right-rail-host')).toBeNull(),
    );
    const dock = screen.getByTestId('navigation-page-action-surface');
    expect(
      within(dock).getByTestId('rag-conversation-sessions-toggle'),
    ).toBeTruthy();
    expect(
      within(dock).getByTestId('rag-conversation-new-session'),
    ).toBeTruthy();
    expect(
      screen.getAllByTestId('rag-conversation-sessions-toggle'),
    ).toHaveLength(1);
    expect(screen.getAllByTestId('rag-conversation-new-session')).toHaveLength(
      1,
    );
    expect(screen.queryByTestId('rag-conversation-history-glass')).toBeNull();
  } finally {
    listener.mockRestore();
  }
});
