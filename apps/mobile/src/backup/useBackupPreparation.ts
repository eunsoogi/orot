import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareBackupSupport } from './backupSupport';
import type { BackupSupportState } from './backupSupport';

export type BackupPreparationDisplayState = BackupSupportState | 'checking';

/** Starts local backup eligibility checks at app launch, even before Settings is opened. */
export function useBackupPreparation() {
  const [state, setState] = useState<BackupPreparationDisplayState>('checking');
  const mounted = useRef(true);

  const retry = useCallback(async () => {
    setState('checking');
    const nextState = await prepareBackupSupport();
    if (mounted.current) setState(nextState);
  }, []);

  useEffect(() => {
    mounted.current = true;
    retry().catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, [retry]);

  return { state, retry };
}
