import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { appColors } from '../../layout/appColors';

/** Applies insets once whether provider selection is standalone or nested in the AI route. */
export function ProviderSelectionFlowShell({
  children,
  safeAreaHandledByParent,
}: {
  readonly children: ReactNode;
  readonly safeAreaHandledByParent: boolean;
}) {
  if (safeAreaHandledByParent) {
    // The integrated AI flow already owns the window insets.
    return <View style={styles.container}>{children}</View>;
  }

  // The standalone route measures insets before positioning its controls.
  return (
    <SafeAreaProvider style={styles.container}>
      <SafeAreaView
        edges={['top', 'right', 'bottom', 'left']}
        style={styles.safeArea}
      >
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: appColors.background },
  safeArea: { flex: 1 },
});
