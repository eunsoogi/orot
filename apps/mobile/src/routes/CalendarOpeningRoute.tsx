import { Button, Text, View } from 'react-native';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import { t } from '../i18n';
import { appRouteStyles } from './WelcomeRoute';

interface CalendarOpeningRouteProps {
  error: string;
  loading: boolean;
  onRetry: () => void;
  onBack: () => void;
}

// Keep Calendar's loading and retry state separate from its linked-data screen.
export function CalendarOpeningRoute({
  error,
  loading,
  onRetry,
  onBack,
}: CalendarOpeningRouteProps) {
  return (
    <SafeAreaLayout scrollable>
      <View style={appRouteStyles.container}>
        <Text accessibilityRole="header" style={appRouteStyles.title}>
          {t('calendar.title')}
        </Text>
        <Text
          accessibilityRole={error ? 'alert' : undefined}
          testID="calendar-app-opening"
        >
          {error || (loading ? t('appointments.opening') : '')}
        </Text>
        {error ? (
          <Button
            onPress={onRetry}
            testID="calendar-app-retry"
            title={t('appointments.retry')}
          />
        ) : null}
        <Button
          onPress={onBack}
          testID="calendar-app-back"
          title={t('calendar.back')}
        />
      </View>
    </SafeAreaLayout>
  );
}
