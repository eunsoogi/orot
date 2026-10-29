import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  RecordingLibraryService,
  RecordingDeleteNotice,
} from './recordingLibraryPanelHelpers';

/** List ownership may change while cleanup is pending; only the matching deletion owns its notice. */
export function useRecordingDeleteNotice(service: RecordingLibraryService) {
  const [deleteNotice, setDeleteNotice] = useState<RecordingDeleteNotice>(null);
  const operation = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    operation.current += 1;
    pending.current = null;
    setDeleteNotice(null);
    return () => {
      operation.current += 1;
      pending.current = null;
    };
  }, [service]);
  const clear = useCallback(() => {
    pending.current = null;
    setDeleteNotice(null);
  }, []);
  const begin = useCallback(() => {
    clear();
    return ++operation.current;
  }, [clear]);
  const fail = useCallback((owner: number) => {
    if (owner === operation.current) setDeleteNotice('error');
  }, []);
  const requestError = useCallback(() => {
    operation.current += 1;
    pending.current = null;
    setDeleteNotice('error');
  }, []);
  const cleanupPending = useCallback((owner: number) => {
    if (owner !== operation.current) return;
    pending.current = owner;
    setDeleteNotice('cleanup-pending');
  }, []);
  const reconciled = useCallback(() => {
    if (pending.current !== operation.current) return;
    pending.current = null;
    setDeleteNotice(current =>
      current === 'cleanup-pending' ? null : current,
    );
  }, []);
  return {
    deleteNotice,
    clear,
    begin,
    fail,
    requestError,
    cleanupPending,
    reconciled,
  };
}
