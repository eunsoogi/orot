import { NativeModules } from 'react-native';
import { providerDiagnostic } from '../providers/diagnostics';
import type { GuardedMutationBoundary } from './guardedMutationBoundary';

/** Resolve the fixed launch opt-in without using app data or enabling a capture. */
export function manualDeletionNativeDiagnostics():
  GuardedMutationBoundary | undefined {
  try {
    if (NativeModules.OrotProviderDiagnostics?.enabled !== true)
      return undefined;
    return (phase, outcome) => {
      try {
        providerDiagnostic(
          'storage',
          `saved_memory_delete_native_${phase}`,
          outcome,
        );
      } catch {
        // The diagnostic observer cannot change success, failure or rollback.
      }
    };
  } catch {
    return undefined;
  }
}
