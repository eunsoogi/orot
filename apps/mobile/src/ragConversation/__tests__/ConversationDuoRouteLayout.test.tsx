import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { AiFeatureRoute } from '../../aiFeatures/integration/AiFeatureRoute';
import {
  apple,
  localData,
  selectionStore,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { runRagConversationTurn } from '../service';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const originalWindow = Dimensions.get('window');

beforeEach(() =>
  Dimensions.set({
    window: { ...originalWindow, width: 390, height: 844, fontScale: 1 },
  }),
);
afterEach(() => Dimensions.set({ window: originalWindow }));

function panelAxis(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('rag-conversation-columns').props.style,
  )?.flexDirection;
}

test('uses the feature route lane for Duo regions and preserves an active conversation', async () => {
  let requestSignal: AbortSignal | undefined;
  const ragRunner = jest.fn(
    (
      _options: Parameters<typeof runRagConversationTurn>[0],
      invocation: Parameters<typeof runRagConversationTurn>[1] = {},
    ) => {
      requestSignal = invocation.signal;
      return new Promise<Awaited<ReturnType<typeof runRagConversationTurn>>>(
        () => undefined,
      );
    },
  ) as unknown as typeof runRagConversationTurn;
  const local = localData([]);

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
        loadLocalData: async () => local.data,
        ragRunner,
      }}
    />,
  );

  expect(screen.getByTestId('rag-conversation-screen')).toBeTruthy();
  // The screen chooses a single native region for its continuous page.
  expect(screen.queryByTestId('navigation-route-columns-route-2')).toBeNull();

  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const expandedGeometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 1400, height: 900 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: true,
    reservedRegions: [
      {
        id: 'hinge',
        kind: 'division',
        frame: { x: 640, y: 0, width: 120, height: 900 },
        margins: noInsets,
        isActive: true,
      },
    ],
  };
  await fireEvent(sensor, 'geometryChange', {
    nativeEvent: expandedGeometry,
  });

  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '현재 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '다음 질문 초안',
  );
  await waitFor(() => expect(ragRunner).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(panelAxis()).toBe('column'));

  const columnsStyle = StyleSheet.flatten(
    screen.getByTestId('rag-conversation-columns').props.style,
  );
  expect(columnsStyle?.columnGap).toBe(0);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-columns-primary').props.style,
    )?.width,
  ).toBeLessThanOrEqual(640);
  expect(screen.queryByTestId('rag-conversation-columns-secondary')).toBeNull();
  expect(screen.getByTestId('rag-conversation-progress')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(requestSignal?.aborted).toBe(false);

  const narrowGeometry: NavigationGeometryPayload = {
    windowBounds: { x: 0, y: 0, width: 320, height: 720 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: false,
    reservedRegions: [],
  };
  await act(async () => {
    Dimensions.set({
      window: { ...originalWindow, width: 320, height: 720, fontScale: 1 },
    });
    await fireEvent(sensor, 'geometryChange', { nativeEvent: narrowGeometry });
  });

  await waitFor(() => expect(panelAxis()).toBe('column'));
  expect(screen.getByTestId('rag-conversation-progress')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 질문 초안',
  );
  expect(requestSignal?.aborted).toBe(false);
  expect(ragRunner).toHaveBeenCalledTimes(1);
});
