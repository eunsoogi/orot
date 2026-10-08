import { Button, Text, View } from 'react-native';
import { t } from '../../i18n';
import { NextVisitQuestionsScreen } from '../../nextVisitQuestions';
import { visitQuestionsRouteStyles as styles } from './NextVisitQuestionsRoute.styles';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { nextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';

export type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';

/** Connects the public #32 screen to the #109 app route and local service hooks. */
export function NextVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  const route = useNextVisitQuestionsRoute(props);

  return (
    <View style={styles.container} testID="next-visit-questions-route">
      <View style={styles.backRow}>
        <Button
          onPress={props.onBack}
          testID="next-visit-questions-back"
          title={t('aiFeatures.back')}
        />
      </View>
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
