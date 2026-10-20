import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { defaultVisitQuestionRouteOperations as defaults } from './visitQuestionsRouteOperations';

/** Stable callbacks read the current visible route without restarting retained work. */
export function retainedVisitInputs(
  read: () => NextVisitQuestionsRouteProps,
): NextVisitQuestionsRouteProps {
  return {
    ...read(),
    onBack: () => read().onBack(),
    onOpenProviderSelection: () => read().onOpenProviderSelection(),
    onOpenSource: reference => read().onOpenSource(reference),
    onRouteStateChange: state => read().onRouteStateChange(state),
    resolveSelectedAi: () => read().resolveSelectedAi(),
    confirmConsent: request => read().confirmConsent(request),
    resolveSource: reference => read().resolveSource(reference),
    registerVisitQuestionSource: (reference, validate) =>
      read().registerVisitQuestionSource(reference, validate),
    loadSavedVisitQuestions: appointmentId =>
      read().loadSavedVisitQuestions(appointmentId),
    operations: {
      loadAppointment: now =>
        (read().operations?.loadAppointment ?? defaults.loadAppointment)(now),
      generate: input =>
        (read().operations?.generate ?? defaults.generate)(input),
      save: input => (read().operations?.save ?? defaults.save)(input),
    },
  };
}
