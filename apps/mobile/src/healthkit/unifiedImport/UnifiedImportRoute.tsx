import SafeAreaLayout from '../../layout/SafeAreaLayout';
import { HealthKitImportScreen } from './HealthKitImportScreen';
import type { UnifiedImportCoordinator } from './HealthKitImportScreen';
import { unifiedHealthImportCopy } from './copy';

declare const require: (path: './localImport') => {
  readonly unifiedHealthImportCoordinator: UnifiedImportCoordinator;
};

interface UnifiedImportRouteProps {
  readonly onBack: () => void;
  readonly safeAreaHandledByParent?: boolean;
}

/** Keeps native provider and storage modules behind explicit user entry. */
export function UnifiedImportRoute({
  onBack,
  safeAreaHandledByParent = false,
}: UnifiedImportRouteProps) {
  // Native services remain lazy; the app shell owns safe area and Glass when embedded.
  const screen = (
    <HealthKitImportScreen
      copy={unifiedHealthImportCopy}
      coordinator={require('./localImport').unifiedHealthImportCoordinator}
      onBack={onBack}
    />
  );
  return safeAreaHandledByParent ? (
    screen
  ) : (
    <SafeAreaLayout>{screen}</SafeAreaLayout>
  );
}
