import { useEffect } from 'react';
import { NativeModules } from 'react-native';

type Event = 'changeText' | 'controlledCommit';
type Observer = {
  run: string;
  record: (event: Event, sequence: number, length: number) => void;
};
let sequence = 0;

/** Only test products export a valid independent run. No content or candidate identity crosses this bridge. */
function observer(): Observer | undefined {
  try {
    const value = NativeModules.OrotEncounterInputObservation;
    return typeof value?.run === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.run,
      ) &&
      typeof value.record === 'function'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function record(event: Event, length: number) {
  try {
    const target = observer();
    if (target) target.record(event, ++sequence, length);
  } catch {
    // Diagnostic delivery failure cannot suppress the original callback or expose its error.
  }
}

/** Observe the synthetic first text editor only; commit effects never claim native prop application. */
export function useInputObservation(
  enabled: boolean,
  value: string,
  onEdit: (text: string) => void,
) {
  useEffect(() => {
    if (enabled) record('controlledCommit', value.length);
  }, [enabled, value]);
  return (text: string) => {
    if (enabled) record('changeText', text.length);
    onEdit(text);
  };
}
