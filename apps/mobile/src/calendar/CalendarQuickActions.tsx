import { Fragment } from 'react';
import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { calendarStyles as styles } from './calendarStyles';

interface CalendarQuickActionsProps {
  disabled: boolean;
  onOpenAppointments?: () => void;
  onOpenMedicalAppointments?: () => void;
}

interface CalendarQuickAction {
  onPress: () => void;
  testID: string;
  title: string;
  symbol: string;
  subtitle?: string;
}

/** Keeps appointment management and explicit AI classification one tap away. */
export function CalendarQuickActions({
  disabled,
  onOpenAppointments,
  onOpenMedicalAppointments,
}: CalendarQuickActionsProps) {
  const actions: CalendarQuickAction[] = [];
  if (onOpenAppointments) {
    actions.push({
      onPress: onOpenAppointments,
      testID: 'schedule-open-appointments',
      title: t('schedule.manageAppointments'),
      symbol: 'calendar',
    });
  }
  if (onOpenMedicalAppointments) {
    actions.push({
      onPress: onOpenMedicalAppointments,
      testID: 'open-medical-appointments',
      title: t('schedule.classifyAppointments'),
      subtitle: t('schedule.classifyAppointmentsHint'),
      symbol: 'tag',
    });
  }
  if (!actions.length) return null;

  return (
    <View style={styles.calendarQuickActions} testID="calendar-quick-actions">
      {actions.map((action, index) => (
        <Fragment key={action.testID}>
          {index > 0 ? (
            <View style={styles.calendarQuickActionDivider} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[action.title, action.subtitle]
              .filter(Boolean)
              .join(', ')}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={action.onPress}
            style={styles.calendarQuickActionCell}
            testID={action.testID}
          >
            <AppSymbol color={appColors.text} name={action.symbol} size={24} />
            <View style={styles.calendarQuickActionCopy}>
              <Text style={styles.calendarQuickActionTitle}>
                {action.title}
              </Text>
              {action.subtitle ? (
                <Text style={styles.calendarQuickActionSubtitle}>
                  {action.subtitle}
                </Text>
              ) : null}
            </View>
            <AppSymbol
              color={appColors.secondary}
              name="chevron.right"
              size={14}
            />
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}
