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
