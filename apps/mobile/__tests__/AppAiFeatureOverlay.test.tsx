import { useEffect } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import App from '../App';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';

const mockFeatureEntryMount = jest.fn();
const mockFeatureEntryUnmount = jest.fn();

jest.mock('../src/aiFeatures/FeatureEntryScreen', () => {
  const React = require('react') as typeof import('react');
  const { Pressable: NativePressable, Text: NativeText } =
    require('react-native') as typeof import('react-native');
  return {
    FeatureEntryScreen: ({
      onOpenVisitQuestions,
    }: {
      onOpenVisitQuestions: () => void;
    }) => {
      React.useEffect(() => {
        mockFeatureEntryMount();
        return () => mockFeatureEntryUnmount();
      }, []);
      return (
        <NativePressable
          onPress={onOpenVisitQuestions}
          testID="open-feature-route"
        >
          <NativeText>Open feature</NativeText>
        </NativePressable>
      );
    },
  };
});

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function VisitQuestionsProbe({
  onRouteStateChange,
}: VisitQuestionsRenderInput) {
  useEffect(() => {
    onRouteStateChange({
      hasUnsavedChanges: false,
      isSaving: false,
      isGenerating: false,
      revision: 0,
    });
  }, [onRouteStateChange]);
  return <Text testID="feature-route-probe">Feature route</Text>;
}

beforeEach(() => {
  mockFeatureEntryMount.mockClear();
  mockFeatureEntryUnmount.mockClear();
});

test('keeps the app screen mounted underneath a guarded AI route', async () => {
  await render(
    <App renderVisitQuestions={input => <VisitQuestionsProbe {...input} />} />,
  );
  await fireEvent.press(screen.getByTestId('navigation-tab-ai'));
  await waitFor(() => expect(mockFeatureEntryMount).toHaveBeenCalledTimes(1));

  await fireEvent.press(screen.getByTestId('open-feature-route'));
  expect(await screen.findByTestId('feature-route-probe')).toBeTruthy();
  expect(mockFeatureEntryUnmount).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(screen.getByTestId('open-feature-route')).toBeVisible(),
  );
  expect(mockFeatureEntryMount).toHaveBeenCalledTimes(1);
  expect(mockFeatureEntryUnmount).not.toHaveBeenCalled();
});
