import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { diseaseHypothesisCopy as copy } from './copy';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from './task';

interface DiseaseHypothesesScreenProps {
  readonly onBack: () => void;
  readonly onGenerate: () => Promise<DiseaseHypothesisRunOutcome>;
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
  onOpenSource,
}: {
  readonly title: string;
  readonly references: readonly EvidenceReference[];
  readonly onOpenSource: (reference: EvidenceReference) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {references.map(reference => (
        <Button
          key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
          onPress={() => onOpenSource(reference)}
          title={`${copy.source} · ${reference.sourceId}`}
        />
      ))}
    </View>
  );
}

/** Presents hypotheses only after #117 validates coverage, freshness, and exact citations. */
export function DiseaseHypothesesScreen({
  onBack,
  onGenerate,
  onOpenSource,
}: DiseaseHypothesesScreenProps) {
  const [state, setState] = useState<ScreenState>({ status: 'idle' });

  async function generate() {
    if (state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const outcome = await onGenerate();
      if (outcome.status === 'incomplete_inventory')
        setState({ status: 'insufficient' });
      else if (outcome.result.status === 'result')
        setState({ status: 'result', value: outcome.result.value });
      else if (outcome.result.status === 'needs_clarification')
        setState({ status: 'insufficient' });
      else setState({ status: 'error' });
    } catch {
      setState({ status: 'error' });
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="disease-hypotheses-screen"
    >
      <Button onPress={onBack} title="뒤로" />
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
                onOpenSource={onOpenSource}
              />
              {hypothesis.contraryEvidence.length > 0 ? (
                <EvidenceLinks
                  title={copy.contrary}
                  references={hypothesis.contraryEvidence}
                  onOpenSource={onOpenSource}
                />
              ) : (
                <Text>{copy.noContrary}</Text>
              )}
              <Text style={styles.label}>{copy.missingData}</Text>
              {hypothesis.missingData.length === 0 ? (
                <Text>확인된 추가 정보가 없어요.</Text>
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
