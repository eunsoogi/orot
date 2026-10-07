import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import {
  DesignButton,
  DesignCard,
  DesignNotice,
  DesignScreen,
  DesignText,
  designTokens,
} from '../design';
import { getDiseaseHypothesisCopy } from './copy';
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
      <DesignText style={styles.label} variant="bodyStrong">
        {title}
      </DesignText>
      {references.map(reference => (
        <DesignButton
          key={`${reference.sourceId}:${reference.evidenceId}:${reference.evidenceRevision}`}
          onPress={() => onOpenSource(reference)}
          label={sourceTitle(reference.sourceId)}
          variant="quiet"
        />
      ))}
    </View>
  );
}

/** Keeps uncertainty beside each result; #117 still owns validation and exact citations. */
export function DiseaseHypothesesScreen({
  onBack,
  onGenerate,
  onOpenSource,
}: DiseaseHypothesesScreenProps) {
  const copy = getDiseaseHypothesisCopy();
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
    <DesignScreen
      backAction={{ label: copy.back, onPress: onBack }}
      description={copy.explanation}
      testID="disease-hypotheses-screen"
      title={copy.title}
    >
      <DesignButton
        accessibilityState={{ busy: state.status === 'loading' }}
        disabled={state.status === 'loading'}
        onPress={() => {
          generate().catch(() => setState({ status: 'error' }));
        }}
        testID="disease-hypotheses-generate"
        label={state.status === 'error' ? copy.retry : copy.generate}
      />
      {state.status === 'loading' ? (
        <DesignNotice
          busy
          message={copy.loading}
          testID="disease-hypotheses-loading"
        />
      ) : null}
      {state.status === 'insufficient' ? (
        <DesignNotice
          message={copy.insufficient}
          testID="disease-hypotheses-insufficient"
          tone="warning"
        />
      ) : null}
      {state.status === 'error' ? (
        <DesignNotice message={copy.error} tone="danger" />
      ) : null}
      {state.status === 'result' ? (
        <View style={styles.results} testID="disease-hypotheses-results">
          {state.value.hypotheses.map((hypothesis, index) => (
            <DesignCard key={`${hypothesis.title}-${index}`}>
              <DesignText accessibilityRole="header" variant="heading">
                {hypothesis.title}
              </DesignText>
              <DesignText>{hypothesis.summary}</DesignText>
              <DesignText style={styles.label} variant="bodyStrong">
                {copy.uncertainty}
              </DesignText>
              <DesignNotice message={hypothesis.uncertainty} tone="warning" />
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
                <DesignText tone="secondary">{copy.noContrary}</DesignText>
              )}
              <DesignText style={styles.label} variant="bodyStrong">
                {copy.missingData}
              </DesignText>
              {hypothesis.missingData.length === 0 ? (
                <DesignText tone="secondary">
                  {copy.noAdditionalInfo}
                </DesignText>
              ) : null}
              {hypothesis.missingData.map(item => (
                <DesignText key={item}>• {item}</DesignText>
              ))}
            </DesignCard>
          ))}
        </View>
      ) : null}
    </DesignScreen>
  );
}

const styles = StyleSheet.create({
  results: { gap: designTokens.spacing.lg },
  label: { marginTop: designTokens.spacing.sm },
  section: { gap: designTokens.spacing.sm },
});
