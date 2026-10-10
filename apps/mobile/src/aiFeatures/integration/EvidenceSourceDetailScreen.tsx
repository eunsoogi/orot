import { useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { t } from '../../i18n';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { presentEvidenceSource } from './evidenceSourcePresentation';
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
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: false,
      isRecording: false,
      // Citation reads stop on unmount, so shared navigation confirms before aborting them.
      hasOngoingOperation: state.status === 'loading',
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
      contentContainerStyle={styles.container}
      testID="ai-feature-source-detail"
    >
      <Button
        onPress={onBack}
        testID="ai-feature-source-back"
        title={t('aiFeatures.back')}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t('aiFeatures.source.title')}
      </Text>
      {state.status === 'loading' ? (
        <Text testID="ai-feature-source-loading">
          {t('aiFeatures.source.loading')}
        </Text>
      ) : null}
      {state.status === 'missing' ? (
        <Text accessibilityRole="alert" testID="ai-feature-source-missing">
          {t('aiFeatures.source.missing')}
        </Text>
      ) : null}
      {state.status === 'changed' ? (
        <Text accessibilityRole="alert" testID="ai-feature-source-changed">
          {t('aiFeatures.source.changed')}
        </Text>
      ) : null}
      {state.status === 'unavailable' ? (
        <View>
          <Text
            accessibilityRole="alert"
            testID="ai-feature-source-unavailable"
          >
            {t('aiFeatures.source.unavailable')}
          </Text>
          <Button
            onPress={() => setAttempt(value => value + 1)}
            testID="ai-feature-source-retry"
            title={t('appointments.retry')}
          />
        </View>
      ) : null}
      {presentation.map((section, sectionIndex) => (
        <View key={`${section.title}-${sectionIndex}`} style={styles.section}>
          <Text accessibilityRole="header" style={styles.title}>
            {section.title}
          </Text>
          {section.rows.map((row, rowIndex) => (
            <View key={`${row.label}-${rowIndex}`} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text selectable style={styles.value}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  section: {
    borderColor: '#C9D4D1',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
  row: { gap: 2 },
  label: { color: '#45524F', fontSize: 13, fontWeight: '600' },
  value: { color: '#17212B', fontSize: 15, lineHeight: 21 },
});
