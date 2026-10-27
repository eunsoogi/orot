import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';

/** Keeps route-opening errors readable and retryable inside the current usable route area. */
export function RouteLoadError({
  title,
  message,
  onRetry,
}: {
  readonly title: string;
  readonly message: string;
  readonly onRetry: () => void | Promise<unknown>;
}) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return (
    <NavigationRouteScrollView>
      <View style={styles.container} testID="route-load-error-content">
        <Text accessibilityRole="header">{title}</Text>
        <Text accessibilityRole="alert">{message}</Text>
        <AppButton
          onPress={onRetry}
          testID="route-load-retry"
          title={t('appointments.retry')}
        />
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  // The scroll view owns changing safe-area and rail insets; this cap only limits long reading lines.
  container: {
    alignSelf: 'center',
    flexGrow: 1,
    gap: 12,
    maxWidth: 640,
    padding: 24,
    width: '100%',
  },
});
