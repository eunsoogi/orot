import {
  ActivityIndicator,
  StyleSheet,
  useColorScheme,
  ScrollView,
  View,
} from 'react-native';
import { useMemo } from 'react';
import { AppText as Text } from '../../layout/AppText';
import { t } from '../../i18n';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { SavedQuestionsSection } from '../../nextVisitQuestions/SavedQuestionsSection';
import { AppointmentSection } from '../../nextVisitQuestions/NextVisitComponents';
import { savedVisitPresentation } from '../../nextVisitQuestions/savedVisitPresentation';
import { useNextVisitQuestionsRoute } from './useNextVisitQuestionsRoute';
import { createNextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { appColors } from '../../layout/appColors';
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
      style={styles.screen}
      contentContainerStyle={[styles.page, inset]}
      testID="saved-visit-questions-screen"
    >
      <View style={styles.content} testID="saved-visit-questions-content">
        {/* The stable heading identity distinguishes this native element from its nested text node. */}
        <Text
          style={styles.heading}
          accessibilityRole="header"
          testID="saved-visit-questions-title"
        >
          {t('ragConversation.history.savedVisitQuestions')}
        </Text>
        <View
          style={styles.section}
          testID="saved-visit-appointment-state"
          accessibilityState={{ busy: route.appointment.status === 'loading' }}
        >
          {route.appointment.status === 'loading' ? (
            <ActivityIndicator
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              color={appColors.primaryText}
            />
          ) : null}
          <AppointmentSection
            appointment={route.appointment}
            onRefresh={route.refreshAppointment}
            theme={theme}
          />
        </View>
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
          <Text>{t('visitQuestions.saved.emptyForVisit')}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

// Keep one scroll owner and stable page spacing through loading, retry and saved results.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  page: { flexGrow: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 20,
  },
  heading: { fontSize: 34, fontWeight: '700' },
  section: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
});
