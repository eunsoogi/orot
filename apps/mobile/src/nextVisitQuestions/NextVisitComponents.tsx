import { Pressable, Text, View } from 'react-native';
import type { Appointment } from '@orot/domain';
import { nextVisitQuestionsCopy as copy } from './copy';
import { formatNextVisitTime } from './format';
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
  readonly variant?: 'primary' | 'secondary';
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
        variant === 'primary' ? styles.button : styles.secondaryButton,
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
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {copy.appointment.heading}
      </Text>
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
        <AppointmentDetails
          appointment={appointment.appointment}
          theme={theme}
        />
      )}
    </View>
  );
}

function AppointmentDetails({
  appointment,
  theme,
}: {
  readonly appointment: Appointment;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const styles = createNextVisitStyles(theme);
  const time = formatNextVisitTime(appointment);
  const title =
    appointment.calendarEventSnapshot?.title?.trim() ||
    appointment.clinicLabel?.trim() ||
    copy.appointment.fallbackTitle;
  return (
    <View>
      <Text style={styles.body}>{title}</Text>
      {appointment.clinicLabel && appointment.clinicLabel !== title ? (
        <Text style={styles.muted}>{appointment.clinicLabel}</Text>
      ) : null}
      <Text style={styles.body} testID="next-visit-appointment-time">
        {time?.label ?? copy.appointment.timeUnavailable}
      </Text>
      {time?.timeZoneNote === 'device' ? (
        <Text style={styles.muted}>{copy.appointment.deviceTimeZone}</Text>
      ) : time?.timeZoneNote === 'calendar_unreadable' ? (
        <Text style={styles.warning}>
          {copy.appointment.invalidCalendarTimeZone}
        </Text>
      ) : null}
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
      {provider.status === 'available' || provider.status === 'unavailable' ? (
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
