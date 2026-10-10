import SafeAreaLayout from '../../layout/SafeAreaLayout';
import { HealthKitImportScreen } from './HealthKitImportScreen';
import type { UnifiedImportCoordinator } from './HealthKitImportScreen';
import { unifiedHealthImportCopy } from './copy';

declare const require: (path: './localImport') => {
  readonly unifiedHealthImportCoordinator: UnifiedImportCoordinator;
};

interface UnifiedImportRouteProps {
  readonly onBack: () => void;
}

/** Keeps native provider and storage modules behind explicit user entry. */
export function UnifiedImportRoute({ onBack }: UnifiedImportRouteProps) {
  // This screen owns its scroller and requests provider access only after selection.
  return (
    <SafeAreaLayout>
      <HealthKitImportScreen
        copy={unifiedHealthImportCopy}
        coordinator={require('./localImport').unifiedHealthImportCoordinator}
        onBack={onBack}
      />
    </SafeAreaLayout>
  );
}
