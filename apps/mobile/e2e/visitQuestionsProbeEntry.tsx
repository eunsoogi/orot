// LangGraph dependencies read the stream and encoding shims during module load.
import '../src/agent/polyfills';
import { useState } from 'react';
import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  AppRegistry,
  Button,
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { name as appName } from '../app.json';
import { formatNumber, t } from '../src/i18n';
import { VisitQuestionReview } from '../src/agent/visitQuestions/VisitQuestionReview';
import type { VisitQuestionCandidate } from '../src/agent/visitQuestions/taskContract';
import { runVisitQuestionWorkflow } from '../src/agent/visitQuestions/workflow';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../src/providers/selection/types';
import {
  createPreparedContext,
  createSyntheticProvider,
  createVisitQuestionsProbeMetrics,
  type VisitQuestionsProbeMetrics,
} from './visitQuestionsProbe';

type ProbeStatus = 'idle' | 'running' | 'review' | 'failure';

function hasSyntheticProbeMode(): boolean {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const mode =
    settingsManager?.settings?.OROT_VISIT_QUESTIONS_PROBE ??
    settingsManager?.getConstants?.().settings?.OROT_VISIT_QUESTIONS_PROBE;
  return mode === 'synthetic';
}

function providerOption(
  provider: LanguageModelProvider,
  privacyBoundary: ProviderSelectionOption['privacyBoundary'],
): { selection: ProviderSelection; option: ProviderSelectionOption } {
  const selection = {
    providerId: provider.id,
    modelId: 'visit-question-synthetic-model',
  };
  return {
    selection,
    option: {
      provider,
      modelId: selection.modelId,
      displayName: 'Synthetic visit question model',
      privacyBoundary,
      availability: { status: 'available' },
    },
  };
}

function VisitQuestionsProbeEntry() {
  const syntheticMode = hasSyntheticProbeMode();
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [questions, setQuestions] = useState<readonly VisitQuestionCandidate[]>(
    [],
  );
  const [message, setMessage] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentSends, setConsentSends] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<VisitQuestionsProbeMetrics | null>(
    null,
  );

  async function checkDeclinedConsent() {
    setStatus('running');
    setMessage('');
    try {
      const providerMetrics = createVisitQuestionsProbeMetrics();
      const { selection, option } = providerOption(
        createSyntheticProvider(providerMetrics),
        'selected-context-remote',
      );
      const result = await runVisitQuestionWorkflow({
        prepared: createPreparedContext(),
        selection,
        providerOptions: [option],
        recipient: 'Synthetic test account',
        confirmConsent: async () => false,
      });
      if (result.status !== 'consent_required' || providerMetrics.calls !== 0) {
        throw new Error('Declined consent did not stop provider dispatch.');
      }
      setConsentSends(providerMetrics.calls);
      setConsentChecked(true);
      setStatus('idle');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus('failure');
    }
  }

  async function prepareQuestions() {
    setStatus('running');
    setMessage('');
    try {
      const providerMetrics = createVisitQuestionsProbeMetrics();
      const { selection, option } = providerOption(
        createSyntheticProvider(providerMetrics),
        'on-device',
      );
      const result = await runVisitQuestionWorkflow({
        prepared: createPreparedContext(),
        selection,
        providerOptions: [option],
      });
      if (result.status !== 'ready') {
        throw new Error(
          'Synthetic workflow stopped with ' + result.status + '.',
        );
      }
      if (providerMetrics.privateIdentifierExposed) {
        throw new Error('A private source identifier reached the provider.');
      }
      setMetrics(providerMetrics);
      setQuestions(result.questions);
      setStatus('review');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus('failure');
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="visit-question-probe-scroll"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t('probe.visit.title')}
      </Text>
      <Text style={styles.notice}>{t('probe.visit.notice')}</Text>
      <View style={styles.actions}>
        <Button
          disabled={!syntheticMode || status === 'running'}
          onPress={checkDeclinedConsent}
          testID="visit-question-probe-decline-consent"
          title={t('probe.visit.declineConsent')}
        />
        <Button
          disabled={!syntheticMode || status === 'running'}
          onPress={prepareQuestions}
          testID="visit-question-probe-prepare"
          title={t('probe.visit.prepare')}
        />
      </View>
      {!syntheticMode ? (
        <Text testID="visit-question-probe-mode-required">
          {t('probe.visit.modeRequired', {
            mode: 'OROT_VISIT_QUESTIONS_PROBE=synthetic',
          })}
        </Text>
      ) : null}
      {consentChecked ? (
        <Text testID="visit-question-probe-consent-result">
          {t('probe.visit.consentResult', {
            count: consentSends === null ? '' : formatNumber(consentSends),
          })}
        </Text>
      ) : null}
      {status === 'running' ? (
        <Text testID="visit-question-probe-running">
          {t('probe.visit.running')}
        </Text>
      ) : null}
      {status === 'failure' ? (
        <Text accessibilityRole="alert" testID="visit-question-probe-failure">
          {t('probe.visit.failure', { message })}
        </Text>
      ) : null}
      {status === 'review' ? (
        <View testID="visit-question-review-screen">
          {metrics ? (
            <Text testID="visit-question-probe-metrics">
              synthetic=true · provider calls={metrics.calls} · evidence
              references={metrics.allowedReferenceCount} · raw IDs exposed=
              {String(metrics.privateIdentifierExposed)}
            </Text>
          ) : null}
          {/* This screen probe stops before durable saving; persistence is exercised separately. */}
          <VisitQuestionReview
            appointmentLabel="합성 외래 방문 · 2035년 6월 2일"
            memoryStatus="no_matching_current_memory"
            message={message}
            questions={questions}
            onCancel={() => setStatus('idle')}
            onConfirm={() => {}}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16, padding: 20 },
  title: { color: '#172554', fontSize: 22, fontWeight: '700' },
  notice: { color: '#334155', fontSize: 14, lineHeight: 20 },
  actions: { gap: 12 },
});

// A separate AppRegistry entry lets UI tests exercise the real screen without changing the app router.
AppRegistry.registerComponent(appName, () => VisitQuestionsProbeEntry);
