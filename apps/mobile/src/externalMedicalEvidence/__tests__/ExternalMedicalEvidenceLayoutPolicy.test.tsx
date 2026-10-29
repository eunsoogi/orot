import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, Pressable, StyleSheet, Text } from 'react-native';
import { FeatureEntryScreen } from '../../aiFeatures/FeatureEntryScreen';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { ExternalMedicalEvidenceScreen } from '../ExternalMedicalEvidenceScreen';
import type { EuropePmcMedicalEvidenceService } from '../europePmc';
import { publications } from '../testSupport/literatureLayoutFixtures';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const viewport = (width: number) => ({
  ...originalWindow,
  width,
  height: 600,
  scale: 1,
  fontScale: 1,
});

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 600 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: width / 2 - 5, y: 0, width: 10, height: 600 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}

beforeEach(() => {
  Dimensions.set({ window: viewport(900), screen: viewport(900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

test('uses the production route policy and retains literature selection through reflow', async () => {
  const controller = createNavigationController<AppNavigationRoute | 'article'>(
    'home',
  );
  const rootTabs = { activeTab: 'ai' as const, onSelect: jest.fn() };
  const onNavigationStateChange = jest.fn();
  const service: EuropePmcMedicalEvidenceService = {
    search: jest.fn(async () => ({
      status: 'available' as const,
      publications,
    })),
  };

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      // Stub child routes have no draft or task; production children register their own state.
      leaveState={{
        readState: () => ({
          hasUnsavedChanges: false,
          isRecording: false,
          hasOngoingOperation: false,
          revision: 0,
          inputRevision: 0,
        }),
      }}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
    >
      {actions =>
        actions.route.name === 'external-evidence' ? (
          <ExternalMedicalEvidenceScreen
            navigationRouteKey={actions.route.key}
            onBack={actions.onBack}
            onNavigationStateChange={onNavigationStateChange}
            onOpenArticle={() => actions.push('article')}
            providerSelection={
              <Pressable
                testID="literature-provider-picker"
                onPress={() => actions.push('settings-provider')}
              >
                <Text>AI 선택</Text>
              </Pressable>
            }
            service={service}
          />
        ) : actions.route.name === 'home' ? (
          <FeatureEntryScreen
            onOpenVisitQuestions={jest.fn()}
            onOpenDiseaseHypotheses={jest.fn()}
            onOpenRagConversation={jest.fn()}
            onOpenExternalEvidence={() => actions.push('external-evidence')}
          />
        ) : (
          <Text testID={`route-${actions.route.name}`}>
            {actions.route.name}
          </Text>
        )
      }
    </NavigationRouteAdapter>,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  const routeKey = controller.getSnapshot().currentRoute.key;
  expect(controller.getSnapshot().currentRoute.name).toBe('external-evidence');
  const duoGeometry = geometry(900, true);
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  await fireEvent(sensor, 'geometryChange', { nativeEvent: duoGeometry });

  // One measured panel keeps query, results, and details in the same vertical reading order.
  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('external-medical-evidence-columns').props.style,
    ),
  ).toMatchObject({ flexDirection: 'column' });
  expect(
    screen.queryByTestId('external-medical-evidence-columns-secondary'),
  ).toBeNull();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('external-medical-evidence-columns-primary').props
        .style,
    ).width,
  ).toBeLessThanOrEqual(445);

  await fireEvent.changeText(
    screen.getByTestId('external-evidence-query'),
    'sleep',
  );
  await fireEvent.press(screen.getByTestId('external-evidence-search'));
  await fireEvent.press(
    await screen.findByTestId('inference-disclosure-allow'),
  );
  expect(service.search).toHaveBeenCalledWith('sleep', {
    externalQueryConsented: true,
    signal: expect.any(AbortSignal),
  });

  await fireEvent.press(
    await screen.findByTestId(
      'external-evidence-publication-MED-SYNTHETIC-SECOND',
    ),
  );
  const narrowGeometry = geometry(640, false);
  await act(async () => {
    Dimensions.set({ window: viewport(640), screen: viewport(640) });
    await fireEvent(sensor, 'geometryChange', { nativeEvent: narrowGeometry });
  });

  expect(
    StyleSheet.flatten(
      screen.getByTestId('external-medical-evidence-columns').props.style,
    ),
  ).toMatchObject({ flexDirection: 'column' });
  expect(screen.getByTestId('external-evidence-query').props.value).toBe(
    'sleep',
  );
  expect(
    screen.getByTestId('external-evidence-publication-MED-SYNTHETIC-SECOND')
      .props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(
    within(screen.getByTestId('external-evidence-selected-source')).getByText(
      'Synthetic exercise study',
    ),
  ).toBeTruthy();
  // The production stack retains the same screen instance during AI and source presentation.
  for (const action of [
    'literature-provider-picker',
    'external-evidence-open-selected-source',
  ]) {
    await fireEvent.press(screen.getByTestId(action));
    expect(controller.getSnapshot().currentRoute.name).not.toBe(
      'external-evidence',
    );
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.key).toBe(routeKey);
    expect(screen.getByTestId('external-evidence-query').props.value).toBe(
      'sleep',
    );
    expect(
      screen.getByTestId('external-evidence-publication-MED-SYNTHETIC-SECOND')
        .props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(service.search).toHaveBeenCalledTimes(1);
  }
});
