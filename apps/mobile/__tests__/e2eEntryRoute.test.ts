import { selectEntryRoute } from '../e2e/selectEntryRoute';

describe('Detox entry routing', () => {
  it('keeps the storage probe as the default route', () => {
    expect(selectEntryRoute({})).toBe('storage');
  });

  it('opens manual appointments only through the test-only probe selector', () => {
    expect(selectEntryRoute({ OROT_E2E_PROBE: 'appointments' })).toBe(
      'appointments',
    );
  });

  it('opens #108 through the production App navigation only by explicit E2E selection', () => {
    expect(
      selectEntryRoute({
        OROT_E2E_PROBE: 'medical-appointment-app-navigation',
      }),
    ).toBe('medical-appointment-app-navigation');
  });

  it('loads the stream polyfill before importing App for the #108 probe', () => {
    const readableStreamDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'ReadableStream',
    );
    let readableStreamAtAppImport = false;
    Object.defineProperty(globalThis, 'ReadableStream', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      jest.isolateModules(() => {
        jest.doMock('../App', () => {
          readableStreamAtAppImport =
            typeof globalThis.ReadableStream === 'function';
          return { __esModule: true, default: () => null };
        });
        jest.doMock('../app.json', () => ({ name: 'Orot' }));
        jest.doMock('../src/providers/selection/options', () => ({
          createAppleSelectionOption: () => ({
            provider: { id: 'apple-intelligence' },
            modelId: 'on-device-model',
          }),
        }));
        jest.doMock('react-native', () => ({
          AppRegistry: { registerComponent: jest.fn() },
        }));
        jest.doMock('react-native-get-random-values', () => ({}));
        require('../e2e/medicalAppointmentNavigationProbeEntry');
      });

      expect(readableStreamAtAppImport).toBe(true);
    } finally {
      jest.dontMock('../App');
      jest.dontMock('../app.json');
      jest.dontMock('../src/providers/selection/options');
      jest.dontMock('react-native');
      jest.dontMock('react-native-get-random-values');
      if (readableStreamDescriptor) {
        Object.defineProperty(
          globalThis,
          'ReadableStream',
          readableStreamDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, 'ReadableStream');
      }
    }
  });

  it('opens the safe-area keyboard fixture through its test-only selector', () => {
    expect(selectEntryRoute({ OROT_E2E_PROBE: 'safe-area' })).toBe('safe-area');
  });

  it('opens the synthetic blood-pressure safe-area route through its test-only selector', () => {
    expect(
      selectEntryRoute({ OROT_E2E_PROBE: 'safe-area-blood-pressure' }),
    ).toBe('safe-area-blood-pressure');
  });

  it('opens the integrated visit-questions route through its explicit E2E selector', () => {
    // This selector is the only entry to the synthetic App-navigation fixture.
    expect(
      selectEntryRoute({ OROT_E2E_PROBE: 'ai-feature-visit-questions' }),
    ).toBe('ai-feature-visit-questions');
  });

  it('rejects unknown and conflicting test-only selectors', () => {
    expect(() => selectEntryRoute({ OROT_E2E_PROBE: 'unknown' })).toThrow(
      'Unsupported OROT_E2E_PROBE value',
    );
    expect(() =>
      selectEntryRoute({
        OROT_E2E_PROBE: 'appointments',
        OROT_STORAGE_PROBE: 'fresh',
      }),
    ).toThrow('Conflicting Orot E2E probe selectors');
  });
});
