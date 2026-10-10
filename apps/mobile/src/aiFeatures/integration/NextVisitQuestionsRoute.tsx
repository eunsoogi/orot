import { View, useColorScheme } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { useMemo } from 'react';
import { NextVisitQuestionsScreen } from '../../nextVisitQuestions';
import type { VisitQuestionsRenderInput } from './AiFeatureFlowScreen';
import { visitQuestionsRouteStyles as styles } from './NextVisitQuestionsRoute.styles';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';
import { createNextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';

export type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';

/** Connects #32 content to #109 data; the enclosing adapter owns guarded Back. */
export function NextVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  const route = useNextVisitQuestionsRoute(props);
  const colorScheme = useColorScheme();
  const theme = useMemo(
    () => createNextVisitQuestionsTheme(colorScheme === 'dark'),
    [colorScheme],
  );

  return (
    <View style={styles.container} testID="next-visit-questions-route">
      {route.saveNotice ? (
        <Text
          accessibilityRole="alert"
          style={[styles.saveNotice, { color: theme.colors.danger }]}
        >
          {route.saveNotice}
        </Text>
      ) : null}
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
        theme={theme}
      />
    </View>
  );
}

// The flow invokes render callbacks directly; return an element so route hooks keep a component owner.
export function renderVisitQuestionsRoute(input: VisitQuestionsRenderInput) {
  return <NextVisitQuestionsRoute {...input} />;
}
