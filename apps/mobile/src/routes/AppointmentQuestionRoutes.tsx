import { AppointmentPreparationRoute } from '../appointmentReminders/AppointmentPreparationRoute';
import { VisitDayQuestionsRoute } from './VisitDayQuestionsRoute';
import type { AppRouteContentProps } from './AppProps';

/** Notification preparation and the local visit-day reader keep separate purposes. */
export function AppointmentQuestionRoutes({
  actions,
  selectTab,
  loadSavedVisitQuestions,
}: Pick<
  AppRouteContentProps,
  'actions' | 'selectTab' | 'loadSavedVisitQuestions'
>) {
  if (actions.route.name === 'visit-day-questions')
    return (
      <VisitDayQuestionsRoute
        routeKey={actions.route.key}
        loadSavedQuestions={loadSavedVisitQuestions}
      />
    );
  return (
    <AppointmentPreparationRoute
      routeKey={actions.route.key}
      loadSavedQuestions={loadSavedVisitQuestions}
      onOpenSchedule={async () => {
        if (await actions.onHome()) selectTab('schedule');
      }}
    />
  );
}
