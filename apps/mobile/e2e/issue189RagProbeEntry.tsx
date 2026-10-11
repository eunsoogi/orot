import '../src/agent/polyfills';
import { useEffect, useRef, useState } from 'react';
import { AppRegistry, Button, ScrollView, Text } from 'react-native';
import { name as appName } from '../app.json';
import { runIssue189RagProbe } from './issue189RagProbe';
import type { Issue189RagProbeResult } from './issue189RagProbe';

/** Per-field accessibility labels keep real retrieval evidence readable without log capture. */
function Issue189RagProbeEntry() {
  const controller = useRef(new AbortController());
  const [phase, setPhase] = useState('starting');
  const [result, setResult] = useState<Issue189RagProbeResult>();
  useEffect(() => {
    const active = controller.current;
    runIssue189RagProbe(setPhase, active.signal).then(setResult);
    return () => active.abort();
  }, []);
  const answer =
    result?.outcome?.status === 'answer' ? result.outcome.answer : '';
  const citations =
    result?.outcome?.status === 'answer' ? result.outcome.citations : [];
  const summary = result
    ? JSON.stringify({
        availability: result.availability,
        terminal: result.terminal,
        retrieval: result.retrieval,
        requests: result.requests.length,
        responses: result.responses.length,
        publications: result.publications.length,
        citations: citations.length,
        nativeCancellations: result.nativeCancellations.length,
        diagnostics: result.diagnostics.length,
        elapsedMs: result.elapsedMs,
        workflowBudgetMs: result.workflowBudgetMs,
        parentAborted: result.parentAborted,
      })
    : phase;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <Text testID="issue189-rag-phase">{phase}</Text>
      <Button
        title="Cancel diagnostic"
        testID="issue189-rag-cancel"
        onPress={() => controller.current.abort()}
      />
      <Text
        accessible
        testID={result ? 'issue189-rag-result' : 'issue189-rag-running'}
        accessibilityLabel={summary}
      >
        {summary}
      </Text>
      <Text accessible testID="issue189-rag-answer" accessibilityLabel={answer}>
        {answer}
      </Text>
      {result?.consent.map((item, index) => (
        <Text
          accessible
          key={'consent-' + index}
          testID={`issue189-rag-consent-${index}`}
        >
          {JSON.stringify(item)}
        </Text>
      ))}
      {result?.requests.map((url, index) => (
        <Text
          accessible
          key={'request-' + index}
          testID={`issue189-rag-request-${index}`}
        >
          {url}
        </Text>
      ))}
      {result?.responses.map((response, index) => (
        <Text
          accessible
          key={'response-' + index}
          testID={`issue189-rag-response-${index}`}
        >
          {JSON.stringify(response)}
        </Text>
      ))}
      {result?.publications.map((publication, index) => (
        <Text
          accessible
          key={'publication-' + index}
          testID={`issue189-rag-publication-${index}`}
        >
          {publication.title + '\n' + publication.originalUrl}
        </Text>
      ))}
      {citations.map((citation, index) => (
        <Text
          accessible
          key={'citation-' + index}
          testID={`issue189-rag-citation-${index}`}
        >
          {JSON.stringify(citation.locator)}
        </Text>
      ))}
      {result?.diagnostics.map((diagnostic, index) => (
        <Text
          accessible
          key={'diagnostic-' + index}
          testID={`issue189-rag-diagnostic-${index}`}
        >
          {compactDiagnostic(diagnostic)}
        </Text>
      ))}
      {result?.diagnostics.map((diagnostic, index) => (
        <Text
          accessible
          key={'output-' + index}
          testID={`issue189-rag-provider-output-${index}`}
        >
          {JSON.stringify(diagnostic)}
        </Text>
      ))}
      {result?.failure ? (
        <Text accessible testID="issue189-rag-error">
          {result.failure}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Exclude generated content from the compact timing/error receipt. */
function compactDiagnostic(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const { response, ...timing } = value as Record<string, unknown>;
  const provider = response as
    { ok?: boolean; error?: { code?: string; message?: string } } | undefined;
  return JSON.stringify({
    ...timing,
    providerOk: provider?.ok,
    providerError: provider?.error,
  }).slice(0, 500);
}

AppRegistry.registerComponent(appName, () => Issue189RagProbeEntry);
