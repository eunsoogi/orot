import { reportDerivedHeartRateShape } from '../derivedHeartRateShapeDiagnostic';

const mockReport = jest.fn();
let mockEnabled = false;

jest.mock('react-native', () => ({
  NativeModules: {
    OrotProviderDiagnostics: {
      get derivedHeartRateShapeEnabled() {
        return mockEnabled;
      },
      report: (...args: unknown[]) => mockReport(...args),
    },
  },
}));

beforeEach(() => {
  mockEnabled = false;
  mockReport.mockReset();
});

it('requires the dedicated diagnostics opt-in', () => {
  reportDerivedHeartRateShape('restingHeartRate', 'derived_mapped', 2);
  expect(mockReport).not.toHaveBeenCalled();
});

it('reports only bounded counts at supported stages for exact derived types', () => {
  mockEnabled = true;
  reportDerivedHeartRateShape('restingHeartRate', 'derived_mapped', 200);
  reportDerivedHeartRateShape(
    'walkingHeartRateAverage',
    'derived_committed',
    0,
  );
  reportDerivedHeartRateShape('heartRate', 'derived_mapped', 1);
  reportDerivedHeartRateShape('restingHeartRate', 'derived_mapped', 201);
  reportDerivedHeartRateShape('restingHeartRate', 'derived_mapped', 0.5);
  reportDerivedHeartRateShape('restingHeartRate', 'derived_mapped', Number.NaN);
  expect(mockReport.mock.calls).toEqual([
    ['restingHeartRate', 'derived_mapped', '200'],
    ['walkingHeartRateAverage', 'derived_committed', '0'],
  ]);
});

it('does not let a broken optional sink change sync behavior', () => {
  mockEnabled = true;
  mockReport.mockImplementation(() => {
    throw new Error('Unavailable diagnostic sink');
  });
  expect(() => {
    reportDerivedHeartRateShape('restingHeartRate', 'derived_committed', 1);
  }).not.toThrow();
});
