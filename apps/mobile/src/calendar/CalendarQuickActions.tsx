import { Fragment } from 'react';
import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { calendarStyles as styles } from './calendarStyles';

interface CalendarQuickActionsProps {
  dock?: boolean;
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
  dock = false,
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
      symbol: 'tag',
    });
  }
  const hasDock = useNavigationRouteActions(
    actions.map(action => ({
      id: action.testID,
      label: action.title,
      accessibilityLabel: action.title,
      testID: action.testID,
      systemImageName: action.symbol,
      disabled,
      onPress: action.onPress,
    })),
    dock,
  );
  // The shared contextual chrome owns these buttons when Schedule is a stack child.
  // Standalone and fixture calendars retain functional in-content controls.
  if (!actions.length || hasDock) return null;

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
            <AppSymbol color={appColors.text} name={action.symbol} />
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
