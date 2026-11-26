import type { SqlDatabase } from '@orot/storage';
import {
  acquireIndependentReadEpoch,
  independentReadMutation,
} from './protectedReadEpoch';

/** Passive unchanged revision spanning an already-authorized page read. */
export function captureIndependentReadRevision(owner: SqlDatabase) {
  const mutation = independentReadMutation(owner);
  if (mutation === undefined) return;
  const current = () => independentReadMutation(owner) === mutation;
  return {
    current,
    watch(retire: () => void) {
      if (!current()) return;
      const held = acquireIndependentReadEpoch(owner);
      const stop = held?.beforeDispatch(retire);
      if (!held || !stop) {
        held?.dispose();
        return;
      }
      return () => {
        stop();
        held.dispose();
      };
    },
  };
}
