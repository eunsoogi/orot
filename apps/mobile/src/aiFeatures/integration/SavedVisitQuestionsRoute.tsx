import { useColorScheme, ScrollView, View } from 'react-native';
import { useMemo } from 'react';
import { AppText as Text } from '../../layout/AppText';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { SavedQuestionsSection } from '../../nextVisitQuestions/SavedQuestionsSection';
import { AppointmentSection } from '../../nextVisitQuestions/NextVisitComponents';
import { savedVisitPresentation } from '../../nextVisitQuestions/savedVisitPresentation';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';
import { createNextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { visitQuestionsRouteStyles as styles } from './NextVisitQuestionsRoute.styles';
import type { NextVisitQuestionsRouteProps } from './NextVisitQuestionsRoute.types';

/** Keeps the current visit's saved questions and original sources accessible without generation. */
export function SavedVisitQuestionsRoute(props: NextVisitQuestionsRouteProps) {
  const route = useNextVisitQuestionsRoute(props);
  const colorScheme = useColorScheme();
  const theme = useMemo(
    () => createNextVisitQuestionsTheme(colorScheme === 'dark'),
    [colorScheme],
  );
  const inset = useNavigationContentInset();
  const appointmentId =
    route.appointment.status === 'ready'
      ? route.appointment.appointment.id
      : null;
  const saved = savedVisitPresentation(
    appointmentId,
    route.savedQuestions,
    null,
  );
  return (
    <ScrollView
      contentContainerStyle={inset}
      testID="saved-visit-questions-screen"
    >
      <View style={styles.container}>
        {/* The stable heading identity distinguishes this native element from its nested text node. */}
        <Text accessibilityRole="header" testID="saved-visit-questions-title">
          저장된 진료 질문
        </Text>
        <AppointmentSection
          appointment={route.appointment}
          onRefresh={route.refreshAppointment}
          theme={theme}
        />
        <SavedQuestionsSection
          caveats={saved.savedCaveats}
          errorMessage={saved.savedError?.message}
          isReviewing={false}
          hasSharedAction
          onEdit={() => undefined}
          onOpenSource={route.onOpenSource}
          onRetry={route.onRetrySavedQuestions}
          questions={saved.savedQuestions}
          restorationNotice={saved.savedRestorationNotice}
          status={saved.savedStatus}
          theme={theme}
        />
        {saved.savedStatus === 'ready' && saved.savedQuestions.length === 0 ? (
          <Text>이 진료에 저장된 질문이 없어요.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
