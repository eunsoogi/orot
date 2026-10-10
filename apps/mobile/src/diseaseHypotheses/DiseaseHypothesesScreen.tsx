import { useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { getDiseaseHypothesisCopy } from './copy';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './task';

interface DiseaseHypothesesScreenProps {
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onGenerate: (
    signal?: AbortSignal,
  ) => Promise<DiseaseHypothesisRunOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}

type ScreenState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'result'; readonly value: DiseaseHypothesisAnalysis }
  | { readonly status: 'insufficient' }
  | { readonly status: 'error' };

function EvidenceLinks({
  title,
  references,
  sourceTitle,
  onOpenSource,
}: {
  readonly title: string;
  readonly references: readonly EvidenceReference[];
  readonly sourceTitle: (sourceId: string) => string;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {references.map(reference => (
        <Button
          key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
          onPress={() => onOpenSource(reference)}
          title={sourceTitle(reference.sourceId)}
        />
      ))}
    </View>
  );
}

/** Presents hypotheses only after #117 validates coverage, freshness, and exact citations. */
export function DiseaseHypothesesScreen({
  navigationRouteKey,
  onNavigationStateChange,
  onBack,
  onGenerate,
  onOpenSource,
}: DiseaseHypothesesScreenProps) {
  const copy = getDiseaseHypothesisCopy();
  const [state, setState] = useState<ScreenState>({ status: 'idle' });
  const operationController = useRef<AbortController | null>(null);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges: state.status === 'result',
      isRecording: false,
      // The request receives this signal and is aborted when a confirmed leave unmounts.
      hasOngoingOperation: state.status === 'loading',
    },
    0,
    onNavigationStateChange,
  );

  useEffect(
    () => () => {
      operationController.current?.abort();
      operationController.current = null;
    },
    [],
  );

  async function generate() {
    if (state.status === 'loading') return;
    const controller = new AbortController();
    operationController.current = controller;
    setState({ status: 'loading' });
    try {
      const outcome = await onGenerate(controller.signal);
      if (controller.signal.aborted) return;
      if (outcome.status === 'incomplete_inventory')
        setState({ status: 'insufficient' });
      else if (outcome.result.status === 'result')
        setState({ status: 'result', value: outcome.result.value });
      else if (outcome.result.status === 'needs_clarification')
        setState({ status: 'insufficient' });
      else setState({ status: 'error' });
    } catch {
      if (!controller.signal.aborted) setState({ status: 'error' });
    } finally {
      if (operationController.current === controller) {
        operationController.current = null;
      }
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="disease-hypotheses-screen"
    >
      <Button onPress={onBack} title={copy.back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.title}
      </Text>
      <Text>{copy.explanation}</Text>
      <Button
        disabled={state.status === 'loading'}
        onPress={() => {
          generate().catch(() => setState({ status: 'error' }));
        }}
        testID="disease-hypotheses-generate"
        title={state.status === 'error' ? copy.retry : copy.generate}
      />
      {state.status === 'loading' ? (
        <Text testID="disease-hypotheses-loading">{copy.loading}</Text>
      ) : null}
      {state.status === 'insufficient' ? (
        <Text testID="disease-hypotheses-insufficient">
          {copy.insufficient}
        </Text>
      ) : null}
      {state.status === 'error' ? (
        <Text accessibilityRole="alert">{copy.error}</Text>
      ) : null}
      {state.status === 'result' ? (
        <View style={styles.results} testID="disease-hypotheses-results">
          {state.value.hypotheses.map((hypothesis, index) => (
            <View key={`${hypothesis.title}-${index}`} style={styles.card}>
              <Text accessibilityRole="header" style={styles.title}>
                {hypothesis.title}
              </Text>
              <Text>{hypothesis.summary}</Text>
              <Text style={styles.label}>{copy.uncertainty}</Text>
              <Text>{hypothesis.uncertainty}</Text>
              <EvidenceLinks
                title={copy.supporting}
                references={hypothesis.supportingEvidence}
                sourceTitle={copy.source}
                onOpenSource={onOpenSource}
              />
              {hypothesis.contraryEvidence.length > 0 ? (
                <EvidenceLinks
                  title={copy.contrary}
                  references={hypothesis.contraryEvidence}
                  sourceTitle={copy.source}
                  onOpenSource={onOpenSource}
                />
              ) : (
                <Text>{copy.noContrary}</Text>
              )}
              <Text style={styles.label}>{copy.missingData}</Text>
              {hypothesis.missingData.length === 0 ? (
                <Text>{copy.noAdditionalInfo}</Text>
              ) : null}
              {hypothesis.missingData.map(item => (
                <Text key={item}>• {item}</Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  results: { gap: 12 },
  card: {
    borderColor: '#C9D4D1',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
  label: { fontWeight: '700', marginTop: 4 },
  section: { gap: 4 },
});
