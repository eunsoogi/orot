import { fireEvent, render, screen } from '@testing-library/react-native';
import { AiFeatureRoute } from '../src/aiFeatures/integration/AiFeatureRoute';

jest.mock('../src/agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({ consent: {}, disclosureSheet: null }),
}));
jest.mock('../src/aiFeatures/integration/featureServices', () => ({
  createAiFeatureServices: () => ({}),
}));
jest.mock('../src/aiFeatures/integration/AiFeatureFlow', () => {
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    AiFeatureFlow: ({
      navigation,
    }: {
      navigation: { route: { name: string } };
    }) => <Text testID="feature-route-name">{navigation.route.name}</Text>,
  };
});
jest.mock('../src/navigation/NavigationRouteAdapter', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, Text, View } =
    require('react-native') as typeof import('react-native');
  return {
    NavigationRouteAdapter: ({
      children,
      controller,
      onNativeRouteRemovalComplete,
    }: {
      children: (actions: {
        route: { key: string; name: string };
      }) => React.ReactNode;
      controller: ReturnType<
        typeof import('../src/navigation/navigationController').createNavigationController
      >;
      onNativeRouteRemovalComplete?: (routeKey: string) => void;
    }) => {
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
      );
      const previousRouteKey = React.useRef(snapshot.currentRoute.key);
      const removedRouteKey = React.useRef<string | null>(null);
      React.useEffect(
        () =>
          controller.registerLeaveGuard(snapshot.currentRoute.key, () => true),
        [controller, snapshot.currentRoute.key],
      );
      React.useEffect(() => {
        if (
          !snapshot.routes.some(route => route.key === previousRouteKey.current)
        ) {
          removedRouteKey.current = previousRouteKey.current;
        }
        previousRouteKey.current = snapshot.currentRoute.key;
      }, [snapshot.currentRoute.key, snapshot.routes]);
      return (
        <View>
          <Text testID="native-route-name">{snapshot.currentRoute.name}</Text>
          {children({
            route: snapshot.currentRoute,
            onBack: controller.requestBack,
          } as never)}
          <Pressable
            onPress={() => void controller.requestBack()}
            testID="request-native-back"
          >
            <Text>Back</Text>
          </Pressable>
          {/* A closing transition event is delivered only after native removal has finished. */}
          <Pressable
            onPress={() => {
              const routeKey = removedRouteKey.current;
              if (routeKey) onNativeRouteRemovalComplete?.(routeKey);
            }}
            testID="finish-native-removal"
          >
            <Text>Finish transition</Text>
          </Pressable>
        </View>
      );
    },
  };
});

test('keeps the AI overlay mounted until the native closing transition completes', async () => {
  const onBack = jest.fn();
  await render(
    <AiFeatureRoute initialRoute="visit-questions" onBack={onBack} />,
  );

  await fireEvent.press(screen.getByTestId('request-native-back'));
  expect(screen.getByTestId('native-route-name')).toHaveTextContent('app-home');
  expect(onBack).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('finish-native-removal'));
  expect(onBack).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('finish-native-removal'));
  expect(onBack).toHaveBeenCalledTimes(1);
});
