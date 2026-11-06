import { useEffect } from 'react';
import { observeNavigationTest } from './navigationTestObservation';

/** The opt-in test sink records actual planner inputs and decisions without route content. */
export function useNavigationAllocationObservation(
  value: Readonly<Record<string, unknown>>,
) {
  const diagnostic = JSON.stringify(value);
  useEffect(() => {
    observeNavigationTest('navigation-allocation', { diagnostic });
  }, [diagnostic]);
}
