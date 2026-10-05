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
