import { useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';
import type { Appointment } from '@orot/storage';
import { NextVisitQuestionsRoute } from '../aiFeatures/integration/NextVisitQuestionsRoute';
import type { NextVisitQuestionsRouteProps } from '../aiFeatures/integration/NextVisitQuestionsRoute.types';
import { defaultVisitQuestionRouteOperations as defaults } from '../aiFeatures/integration/visitQuestionsRouteOperations';
import { useAppointmentReminderRuntime } from '../appointmentReminders/AppointmentReminderContext';
import { nextVisitQuestionsCopy as copy } from '../nextVisitQuestions/copy';
import { isEligibleNextVisit } from './nextAppointment';

/** This is only an entry eligibility check. The generator still performs its original current-query, fingerprint and consent validation. */
export function canGenerateOverviewVisit(
  appointment: Appointment,
  now = Date.now(),
): boolean {
  return (
    isEligibleNextVisit(appointment, now) &&
    appointment.provenance.origin === 'user_reported' &&
    Boolean(
      appointment.calendarEventIdentifier && appointment.calendarEventSnapshot,
    ) &&
    Date.parse(appointment.effectiveAt) >= now
  );
}

/** Pins an Overview entry to its route's visit without changing the AI selection policy. */
function OverviewVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  const focused = useIsFocused();
  const runtime = useAppointmentReminderRuntime();
  const routeKey = props.navigationRouteKey ?? '';
  const expectedId = runtime?.overviewPreparationTargets.get(routeKey);
  const operations = useMemo(() => {
    if (!expectedId) return undefined;
    const isCurrent = async (appointment: Appointment) => {
      const current = await defaults.loadAppointment(new Date().toISOString());
      return (
        appointment.id === expectedId &&
        current?.id === expectedId &&
        canGenerateOverviewVisit(current)
      );
    };
    return {
      ...defaults,
      async loadAppointment(now: string) {
        const current = await defaults.loadAppointment(now);
        return current?.id === expectedId && canGenerateOverviewVisit(current)
          ? current
          : null;
      },
      async generate(input: Parameters<typeof defaults.generate>[0]) {
        if (input.signal.aborted) return { status: 'cancelled' as const };
        if (!(await isCurrent(input.appointment)))
          return {
            status: 'refresh_required' as const,
            message: copy.generation.refreshRequired,
          };
        return defaults.generate(input);
      },
      async save(input: Parameters<typeof defaults.save>[0]) {
        if (!(await isCurrent(input.appointment)))
          throw new Error('The Overview preparation target changed.');
        return defaults.save(input);
      },
    };
  }, [expectedId]);
  return (
    <NextVisitQuestionsRoute
      {...props}
      operations={operations}
      // Preserve existing session identities for previously saved conversations.
      sessionScope={expectedId ? 'home:' + routeKey : 'default'}
      sessionActive={focused}
    />
  );
}

// Keep hooks owned by an element: the feature flow invokes render callbacks directly.
export function renderVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  return <OverviewVisitQuestionsRoute {...props} />;
}
