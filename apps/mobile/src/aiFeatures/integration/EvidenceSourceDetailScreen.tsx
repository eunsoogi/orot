import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { t } from '../../i18n';
import { AppButton } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { navigationText } from '../../i18n/navigation';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { presentEvidenceSource } from './evidenceSourcePresentation';
import { EvidenceSourceSections } from './EvidenceSourceSections';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from './useAiFeatureNavigationState';

interface EvidenceSourceDetailScreenProps {
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly reference: EvidenceReference;
  readonly onBack: () => void;
  readonly readSource: (
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>;
}

type ScreenState =
  | { readonly status: 'loading' }
  | Exclude<EvidenceSourceReadResult, { readonly status: 'unavailable' }>
  | { readonly status: 'unavailable' };

/** Re-reads a citation on entry and discards the result if the screen closes mid-request. */
export function EvidenceSourceDetailScreen({
  navigationRouteKey,
  onNavigationStateChange,
  reference,
  onBack,
  readSource,
}: EvidenceSourceDetailScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      // A read has no user-owned work to lose; unmount cancels it without blocking UIKit's pop.
      hasOngoingOperation: false,
    },
    attempt,
    onNavigationStateChange,
  );

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setState({ status: 'loading' });
    readSource(reference, controller.signal)
      .then(result => {
        if (mounted) setState(result);
      })
      .catch(() => {
        if (mounted) setState({ status: 'unavailable' });
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [attempt, readSource, reference]);

  const presentation =
    state.status === 'available' ? presentEvidenceSource(state.document) : [];
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, navigationInset]}
      testID="ai-feature-source-detail"
    >
      {/* Integrated routes use the shared bottom menu; standalone probes retain local Back. */}
      {navigationRouteKey ? null : (
        <AppButton
          accessibilityLabel={navigationText.back.accessibilityLabel}
          onPress={onBack}
          testID="ai-feature-source-back"
          title={navigationText.back.label}
        />
      )}
      <Text accessibilityRole="header" style={styles.heading}>
        근거 살펴보기
      </Text>
      <Text style={styles.subtitle}>답변에 인용된 저장 기록</Text>
      {state.status === 'loading' ? (
        <Text testID="ai-feature-source-loading">
          {t('aiFeatures.source.loading')}
        </Text>
      ) : null}
      {state.status === 'missing' ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="ai-feature-source-missing"
        >
          {t('aiFeatures.source.missing')}
        </Text>
      ) : null}
      {state.status === 'changed' ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="ai-feature-source-changed"
        >
          {t('aiFeatures.source.changed')}
        </Text>
      ) : null}
      {state.status === 'unavailable' ? (
        <View>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="ai-feature-source-unavailable"
          >
            {t('aiFeatures.source.unavailable')}
          </Text>
          <AppButton
            onPress={() => setAttempt(value => value + 1)}
            testID="ai-feature-source-retry"
            title={t('appointments.retry')}
          />
        </View>
      ) : null}
      {state.status === 'available' ? (
        <EvidenceSourceSections sections={presentation} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: appColors.background },
  container: { gap: 12, paddingHorizontal: 24, paddingTop: 20 },
  // Match the selected reference title without overriding system text scaling or its existing weight.
  heading: { fontSize: 36, fontWeight: '700' },
  subtitle: { fontSize: 14, color: appColors.secondary, marginBottom: 12 },
  error: { color: appColors.danger },
});
