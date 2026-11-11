import { useEffect } from 'react';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';

/** Invalidate visible or pending explanations after their sources may have been removed. */
export function useTreatmentSourceInvalidation(close: () => void) {
  useEffect(() => {
    const unsubscribeSource = subscribeLocalSourceDeletion(close);
    const unsubscribeClear = subscribeLocalDataClear(close);
    return () => {
      unsubscribeSource();
      unsubscribeClear();
    };
  }, [close]);
}
