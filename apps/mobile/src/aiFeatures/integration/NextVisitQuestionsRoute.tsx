import { Text, View } from 'react-native';
import { NextVisitQuestionsScreen } from '../../nextVisitQuestions';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import { visitQuestionsRouteStyles as styles } from './NextVisitQuestionsRoute.styles';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { nextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';

export type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';

/** Connects #32 content to #109 data; the enclosing adapter owns guarded Back. */
export function NextVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  const route = useNextVisitQuestionsRoute(props);

  return (
    <View style={styles.container} testID="next-visit-questions-route">
      <NextVisitQuestionsScreen
        appointment={route.appointment}
        onGenerate={route.onGenerate}
        onOpenProviderSelection={route.openProviderSelection}
        onOpenSource={route.onOpenSource}
        onRefreshAppointment={route.refreshAppointment}
        onRetrySavedQuestions={route.onRetrySavedQuestions}
        onRouteStateChange={props.onRouteStateChange}
        onSaveReviewedQuestions={route.onSaveReviewedQuestions}
        provider={route.provider}
        savedQuestions={route.savedQuestions}
        theme={nextVisitQuestionsTheme}
      />
      {route.saveNotice ? (
        <Text accessibilityRole="alert" style={styles.saveNotice}>
          {route.saveNotice}
        </Text>
      ) : null}
    </View>
  );
}

// The flow invokes render callbacks directly; return an element so route hooks keep a component owner.
export function renderVisitQuestionsRoute(input: VisitQuestionsRenderInput) {
  return <NextVisitQuestionsRoute {...input} />;
}
