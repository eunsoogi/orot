import { observeNavigationTest } from '../navigation/navigationTestObservation';

/** Test-entry opt-in sink only. Fixed geometric fields must never contain input text or labels. */
export function observeSymptomFocus(
  phase: string,
  generation: number,
  fields: Readonly<Record<string, number | boolean | null>> = {},
) {
  // JSON represents an absent keyboard's Infinity edge (or invalid geometry) as null, never as a finite measurement.
  observeNavigationTest('symptom-focus-diagnostic', {
    phase,
    payload: JSON.stringify({ generation, ...fields }),
  });
}
