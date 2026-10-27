import { act, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import {
  event,
  result,
  selectedProvider,
} from '../MedicalAppointmentClassificationScreenTestFixtures';
import { MedicalAppointmentReviewView } from '../MedicalAppointmentReviewView';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';

/** Provides native-window measurements and a real route adapter for layout tests. */
export const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const originalDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};

export const windowBounds = new Map<
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

const candidate = result([event('synthetic-event', '정기 진료', '2035-06-02')])
  .candidates[0]!;

const viewProps = {
  provider: selectedProvider(),
  providerUnavailable: false,
  providerReady: true,
  loading: false,
  calendarLoading: false,
  calendarUnavailable: false,
  classifying: false,
  accessAvailable: true,
  queryComplete: true,
  message: '',
  eventCount: 1,
  candidates: [candidate],
  savingId: null,
  savedIds: new Set<string>(),
  onImport: async () => undefined,
  onOpenManual: jest.fn(),
  onOpenCalendarSettings: jest.fn(),
  onOpenProviderSelection: jest.fn(),
};

beforeEach(() => {
  windowBounds.clear();
  // AdaptiveColumns depends on native host bounds; tests provide deterministic values here.
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const bounds = windowBounds.get(this.props.testID ?? '');
      if (bounds) callback(bounds.x, 0, bounds.width, 800);
    });
});

afterEach(() => {
  Dimensions.set(originalDimensions);
  jest.restoreAllMocks();
});

export async function setWindowSize(width: number, fontScale: number) {
  const window = Dimensions.get('window');
  const screenDimensions = Dimensions.get('screen');
  await act(async () => {
    Dimensions.set({
      window: { ...window, width, fontScale },
      screen: { ...screenDimensions, width, fontScale },
    });
  });
}

export function columnsAxis() {
  return StyleSheet.flatten(
    screen.getByTestId('medical-appointment-columns').props.style,
  )?.flexDirection;
}

function ClassificationRoute({ name }: { readonly name: string }) {
  return (
    <View>
      <Text testID="route-name">{name}</Text>
      <MedicalAppointmentReviewView {...viewProps} />
    </View>
  );
}

export async function renderMedicalRoute() {
  const controller = createNavigationController<'medical' | 'medical-manual'>(
    'medical',
  );
  await render(
    <NavigationRouteAdapter
      controller={controller}
      contentLayoutOwner={appContentLayoutOwner}
    >
      {({ route }) =>
        route.name === 'medical' ? (
          <ClassificationRoute name={route.name} />
        ) : (
          <Text testID="manual-route">manual</Text>
        )
      }
    </NavigationRouteAdapter>,
  );
  return controller;
}
