import { Pressable, Text, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { nextVisitQuestionsCopy as copy } from './copy';
import { VisitAppointmentCard, VisitProviderCard } from './VisitContextCards';
import { createNextVisitStyles } from './styles';
import type {
  AppointmentViewState,
  NextVisitQuestionsTheme,
  ProviderViewState,
} from './types';

interface ActionButtonProps {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly theme: NextVisitQuestionsTheme;
  readonly variant?: 'primary' | 'secondary' | 'link';
  readonly testID: string;
}

/** Applies the shared theme and minimum touch size to screen actions. */
export function ActionButton({
  disabled = false,
  label,
  onPress,
  theme,
  variant = 'primary',
  testID,
}: ActionButtonProps) {
  const styles = createNextVisitStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        // Async controller work publishes its own state; native press events stay synchronous.
        onPress();
      }}
      style={[
        variant === 'primary'
          ? styles.button
          : variant === 'link'
            ? styles.linkButton
            : styles.secondaryButton,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text
        style={
          variant === 'primary' ? styles.buttonText : styles.secondaryButtonText
        }
      >
        {label}
      </Text>
      {variant === 'link' ? (
        <AppSymbol
          name="chevron.right"
          size={14}
          color={theme.colors.accentText}
        />
      ) : null}
    </Pressable>
  );
}

/** Displays the appointment projection supplied by the Calendar adapter. */
export function AppointmentSection({
  appointment,
  onRefresh,
  theme,
}: {
  readonly appointment: AppointmentViewState;
  readonly onRefresh: () => void;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = createNextVisitStyles(theme);
  return (
    <View style={styles.section} testID="next-visit-appointment">
      {appointment.status !== 'ready' ? (
        <Text accessibilityRole="header" style={styles.sectionHeading}>
          {copy.appointment.heading}
        </Text>
      ) : null}
      {appointment.status === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {copy.appointment.loading}
        </Text>
      ) : appointment.status === 'empty' ? (
        <>
          <Text style={styles.body}>{copy.appointment.none}</Text>
          <Text style={styles.muted}>{copy.appointment.noneHelp}</Text>
          <ActionButton
            label={copy.appointment.retry}
            onPress={onRefresh}
            theme={theme}
            variant="secondary"
            testID="next-visit-appointment-retry"
          />
        </>
      ) : appointment.status === 'error' ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {appointment.message ?? copy.appointment.error}
          </Text>
          <ActionButton
            label={copy.appointment.retry}
            onPress={onRefresh}
            theme={theme}
            variant="secondary"
            testID="next-visit-appointment-retry"
          />
        </>
      ) : (
        <VisitAppointmentCard
          appointment={appointment.appointment}
          theme={theme}
        />
      )}
    </View>
  );
}

/** Keeps provider selection explicit and exposes the current data boundary. */
export function ProviderSection({
  provider,
  onChoose,
  theme,
}: {
  readonly provider: ProviderViewState;
  readonly onChoose: () => void;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = createNextVisitStyles(theme);
  if (provider.status === 'available')
    return (
      <VisitProviderCard
        provider={provider}
        onChoose={onChoose}
        theme={theme}
      />
    );
  const message =
    provider.status === 'loading'
      ? copy.provider.loading
      : provider.status === 'unselected'
        ? copy.provider.unselected
        : provider.status === 'error'
          ? (provider.message ?? copy.provider.error)
          : provider.status === 'unavailable'
            ? provider.message || copy.provider.unavailable
            : null;
  return (
    <View style={styles.section} testID="next-visit-provider">
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {copy.provider.heading}
      </Text>
      {provider.status === 'unavailable' ? (
        <>
          <Text style={styles.body}>{provider.displayName}</Text>
          <Text style={styles.muted}>
            {provider.privacyBoundary === 'on-device'
              ? copy.provider.onDevice
              : copy.provider.remote}
          </Text>
        </>
      ) : null}
      {message ? (
        <Text
          accessibilityRole={
            provider.status === 'error' || provider.status === 'unavailable'
              ? 'alert'
              : 'text'
          }
          style={
            provider.status === 'error' || provider.status === 'unavailable'
              ? styles.warning
              : styles.muted
          }
        >
          {message}
        </Text>
      ) : null}
      <ActionButton
        disabled={provider.status === 'loading'}
        label={
          provider.status === 'error'
            ? copy.provider.retry
            : copy.provider.choose
        }
        onPress={onChoose}
        theme={theme}
        variant="secondary"
        testID="next-visit-provider-select"
      />
    </View>
  );
}
