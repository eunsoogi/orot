import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { createAiFeatureServices } from '../featureServices';
import type { AiFeatureServices } from '../featureServices';
import type { DiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/types';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../../../navigation/navigationGeometry';

jest.mock('../featureServices');
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const originalWindow = Dimensions.get('window');
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function viewport(width: number, height: number, fontScale = 1) {
  return { ...originalWindow, width, height, fontScale };
}

function geometry(
  width: number,
  height: number,
  divided: boolean,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height },
    safeAreaInsets: noInsets,
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: 640, y: 0, width: 120, height },
            margins: noInsets,
            isActive: true,
          },
        ]
      : [],
  };
}

function expectHistoryInsideMeasuredRegion(payload: NavigationGeometryPayload) {
  const snapshot = createNavigationGeometrySnapshot(payload);
  expect(snapshot).not.toBeNull();
  if (!snapshot) return;
  const region = snapshot.usableRegions
    .filter(item => item.height >= snapshot.safeAreaFrame.height * 0.6)
    .sort((left, right) => right.width - left.width || left.x - right.x)[0];
  expect(region).toBeDefined();
  if (!region) return;

  const layout = StyleSheet.flatten(
    screen.getByTestId('summary-history-columns').props.style,
  );
  const primary = StyleSheet.flatten(
    screen.getByTestId('summary-history-columns-primary').props.style,
  );
  const start = snapshot.safeAreaFrame.x + Number(layout?.marginStart ?? 0);
  const end = start + Number(primary?.width ?? 0);
  expect(layout?.flexDirection).toBe('column');
  expect(screen.queryByTestId('summary-history-columns-secondary')).toBeNull();
  expect(start).toBeGreaterThanOrEqual(region.x - 0.5);
  expect(end).toBeLessThanOrEqual(region.x + region.width + 0.5);
}

beforeEach(() => {
  Dimensions.set({ window: viewport(1400, 900) });
});

afterEach(() => {
  Dimensions.set({ window: originalWindow });
});

test('keeps history in a measured region and restores saved content and provenance without generation', async () => {
  const source = {
    sourceKind: 'personal_record' as const,
    sourceId: 'saved-record',
    sourceRevision: '1',
    evidenceId: 'saved-evidence',
    evidenceRevision: '1',
    locator: { kind: 'structured_record' as const, recordId: 'saved-record' },
    effectiveTime: '2035-01-01T00:00:00Z',
    reviewState: 'reviewed' as const,
  };
  const value: DiseaseHypothesisAnalysis = {
    presentation: 'symptom_summary',
    hypotheses: [
      {
        title: '저장된 활동 요약',
        summary: '저장된 활동 기록이에요.',
        uncertainty: '',
        missingData: [],
        supportingEvidence: [source],
        contraryEvidence: [],
      },
    ],
    savedSummary: {
      status: 'saved',
      id: 'saved',
      createdAt: '2035-01-01T00:00:00Z',
      modelName: 'Synthetic',
    },
  };
  const history = {
    list: jest.fn(async () => [
      {
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
      },
    ]),
    read: jest.fn(async () => value),
  };
  const generate = jest.fn();
  jest.mocked(createAiFeatureServices).mockReturnValue({
    summaryHistory: history,
    generateDiseaseHypotheses: generate,
    summarizeSymptoms: generate,
  } as unknown as AiFeatureServices);
  await render(
    <AiFeatureRoute initialRoute="disease-hypotheses" onBack={jest.fn()} />,
  );
  const sensor = screen.getByTestId('navigation-window-geometry-sensor');
  const duoGeometry = geometry(1400, 900, true);
  await fireEvent(sensor, 'geometryChange', { nativeEvent: duoGeometry });
  await fireEvent.press(screen.getByTestId('symptom-summary-history-open'));
  expect(await screen.findByTestId('summary-history-screen')).toBeTruthy();
  expect(screen.queryByTestId('symptom-summary-generate')).toBeNull();
  await screen.findByRole('button', { name: /Synthetic/ });
  expectHistoryInsideMeasuredRegion(duoGeometry);

  const largeTextGeometry = geometry(390, 844, false);
  await act(async () => {
    Dimensions.set({ window: viewport(390, 844, 2) });
    await fireEvent(sensor, 'geometryChange', {
      nativeEvent: largeTextGeometry,
    });
  });
  expectHistoryInsideMeasuredRegion(largeTextGeometry);
  expect(await screen.findByRole('button', { name: /Synthetic/ })).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: /Synthetic/ }));
  expect(await screen.findByText('저장된 활동 기록이에요.')).toBeTruthy();
  expect(screen.getByTestId('symptom-summary-saved')).toHaveTextContent(
    /Synthetic/u,
  );
  expect(
    screen.getByLabelText('원문 근거 열기 · 건강 기록 · 2035-01-01'),
  ).toBeTruthy();
  expect(screen.queryByTestId('summary-history-screen')).toBeNull();
  expect(history.read).toHaveBeenCalledWith('saved');
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('symptom-summary-history-open'));
  expect(await screen.findByTestId('summary-history-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('저장된 활동 기록이에요.')).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();
});
