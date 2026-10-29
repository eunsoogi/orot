import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { FeatureEntryScreen } from '../../aiFeatures/FeatureEntryScreen';
import { AiFeatureFlowScreen } from '../../aiFeatures/integration/AiFeatureFlowScreen';
import type { AiFeatureServices } from '../../aiFeatures/integration/featureServices';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import type { NavigationController } from '../../navigation/navigationController';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import type { DiseaseHypothesisRunOutcome } from '../task';

const noop = () => undefined;
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
let activeGeometry = geometry(1280, false);
let routeController: NavigationController<AppNavigationRoute> | undefined;

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const testID = this.props.testID ?? '';
    const routeKey = routeController?.getSnapshot().currentRoute.key;
    if (testID === `navigation-route-columns-${routeKey}-host`) {
      callback(
        activeGeometry.windowBounds.x,
        0,
        activeGeometry.windowBounds.width,
        600,
      );
      return;
    }
    if (testID === 'disease-hypotheses-columns-frame-host') {
      // The inner screen measures its actual route parent when the scene owns layout.
      const parentPanel = routeKey
        ? screen.queryByTestId(`navigation-route-columns-${routeKey}-primary`)
        : null;
      if (parentPanel) {
        const parentLayout = screen.getByTestId(
          `navigation-route-columns-${routeKey}`,
        );
        const panelStyle = StyleSheet.flatten(parentPanel.props.style);
        const layoutStyle = StyleSheet.flatten(parentLayout.props.style);
        callback(
          activeGeometry.windowBounds.x + Number(layoutStyle.marginStart ?? 0),
          0,
          Number(panelStyle.width ?? 0),
          600,
        );
        return;
      }
      callback(
        activeGeometry.windowBounds.x,
        0,
        activeGeometry.windowBounds.width,
        600,
      );
    }
  });

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const safeInsets = { top: 0, left: 0, right: 0, bottom: 34 };
  return {
    SafeAreaInsetsContext: React.createContext(safeInsets),
    useSafeAreaInsets: () => safeInsets,
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

function geometry(width: number, divided: boolean): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 600 },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: width / 2 - 10, y: 0, width: 20, height: 600 },
            margins: noInsets,
            isActive: true,
          },
        ]
      : [],
  };
}

function viewport(width: number) {
  return { ...originalWindow, width, height: 600, scale: 1, fontScale: 1 };
}

function columnsAxis() {
  return StyleSheet.flatten(
    screen.getByTestId('disease-hypotheses-columns').props.style,
  )?.flexDirection;
}

const source = {
  sourceKind: 'personal_record' as const,
  sourceId: 'synthetic-record',
  evidenceId: 'synthetic-evidence',
  sourceRevision: '1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record' as const, recordId: 'synthetic-record' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

function result(title: string): DiseaseHypothesisRunOutcome {
  return {
    status: 'workflow',
    result: {
      status: 'result',
      value: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title,
            summary: 'Synthetic route result.',
            supportingEvidence: [source],
            contraryEvidence: [],
            uncertainty: 'Synthetic evidence only.',
            missingData: [],
          },
        ],
      },
      citations: [source],
      coverage: [],
      checkpoint: {} as never,
    },
  };
}

beforeEach(() => {
  routeController = undefined;
  activeGeometry = geometry(1280, false);
  Dimensions.set({ window: viewport(1280), screen: viewport(1280) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow, screen: originalScreen });
  jest.restoreAllMocks();
});

test('uses both native regions through the production AI route and retains actions when narrow', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  routeController = controller;
  const summary = jest.fn(async () => result('Synthetic symptom summary'));
  const assessment = jest.fn(async () => result('Synthetic assessment result'));
  const onOpenSource = jest.fn();
  const services = {
    summarizeSymptoms: summary,
    generateDiseaseHypotheses: assessment,
  } as unknown as AiFeatureServices;
  const rootTabs = { activeTab: 'ai' as const, onSelect: noop };

  await render(
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route => (route.name === 'home' ? rootTabs : undefined)}
    >
      {actions =>
        actions.route.name === 'home' ? (
          <FeatureEntryScreen
            onOpenDiseaseHypotheses={() => actions.push('disease-hypotheses')}
            onOpenRagConversation={noop}
            onOpenExternalEvidence={noop}
          />
        ) : actions.route.name === 'disease-hypotheses' ? (
          <AiFeatureFlowScreen
            route="disease-hypotheses"
            navigationRouteKey={actions.route.key}
            onFeatureNavigationStateChange={noop}
            onRouteStateChange={noop}
            onBack={noop}
            onOpenDiseaseHypotheses={noop}
            onOpenRagConversation={noop}
            onOpenExternalEvidence={noop}
            onOpenProviderSelection={noop}
            onOpenSource={onOpenSource}
            resolveSelectedAi={async () => ({ status: 'selection-required' })}
            confirmConsent={async () => true}
            selectedAiRevision={0}
            services={services}
            onOpenArticle={noop}
          />
        ) : null
      }
    </NavigationRouteAdapter>,
  );

  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  const routeKey = controller.getSnapshot().currentRoute.key;
  await fireEvent.press(screen.getByTestId('symptom-summary-generate'));
  expect(await screen.findByText('Synthetic symptom summary')).toBeTruthy();

  activeGeometry = geometry(1280, true);
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  await fireEvent(sensor, 'geometryChange', { nativeEvent: activeGeometry });

  expect(
    screen.queryByTestId(`navigation-route-columns-${routeKey}`),
  ).toBeNull();
  expect(columnsAxis()).toBe('column');
  expect(
    screen.getByTestId('disease-hypotheses-columns-secondary'),
  ).toBeTruthy();
  expect(screen.getByTestId('symptom-summary-generate')).toBeTruthy();
  expect(screen.getByTestId('disease-hypotheses-generate')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('원문 근거 열기 · 건강 기록'));
  expect(onOpenSource).toHaveBeenCalledWith(source);

  activeGeometry = geometry(640, false);
  await act(async () => {
    Dimensions.set({ window: viewport(640), screen: viewport(640) });
    await fireEvent(sensor, 'geometryChange', { nativeEvent: activeGeometry });
  });
  expect(columnsAxis()).toBe('column');
  expect(screen.getByText('Synthetic symptom summary')).toBeTruthy();
  expect(screen.getByTestId('symptom-summary-generate')).toBeTruthy();
  expect(screen.getByTestId('disease-hypotheses-generate')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByText('Synthetic assessment result')).toBeTruthy();
  expect(summary).toHaveBeenCalledTimes(1);
  expect(assessment).toHaveBeenCalledTimes(1);
});
