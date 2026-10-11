import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, ScrollView, Text } from 'react-native';
import { name as appName } from '../app.json';
import { runIssue189AppleWorkflowProbe } from './issue189AppleWorkflowProbe';

/** Terminal JSON is an observation; consumers must assert each workflow result. */
function Issue189AppleWorkflowProbeEntry() {
  const [phase, setPhase] = useState('starting');
  const [result, setResult] = useState<string | null>(null);
  const [details, setDetails] =
    useState<Awaited<ReturnType<typeof runIssue189AppleWorkflowProbe>>>();
  useEffect(() => {
    runIssue189AppleWorkflowProbe(setPhase).then(
      value => {
        const serialized = JSON.stringify(value);
        console.log('ISSUE189_APPLE_WORKFLOW_RESULT ' + serialized);
        setDetails(value);
        setResult(serialized);
      },
      error => {
        const serialized = JSON.stringify({
          status: 'probe-error',
          message: String(error),
        });
        console.log('ISSUE189_APPLE_WORKFLOW_RESULT ' + serialized);
        setResult(serialized);
      },
    );
  }, []);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <Text testID="issue189-apple-workflow-phase">{phase}</Text>
      {details ? (
        <>
          <Text
            accessible
            testID="issue189-apple-workflow-summary"
            accessibilityLabel={summary(details)}
          >
            {summary(details)}
          </Text>
          {['calendar', 'nextVisit', 'cancellation'].map(key => {
            const serialized = JSON.stringify({
              phase: key,
              result: record(details)[key],
            });
            return (
              <Text
                key={key}
                accessible
                testID={`issue189-apple-${key}-result`}
                accessibilityLabel={serialized}
              >
                {serialized}
              </Text>
            );
          })}
          {details.diagnostics.map((diagnostic, index) => {
            const serialized = JSON.stringify(diagnostic);
            return (
              <Text
                key={index}
                accessible
                testID={`issue189-apple-diagnostic-${index}`}
                accessibilityLabel={serialized}
              >
                {serialized}
              </Text>
            );
          })}
        </>
      ) : null}
      <Text
        accessible
        testID={
          result === null
            ? 'issue189-apple-workflow-running'
            : 'issue189-apple-workflow-result'
        }
        accessibilityLabel={result ?? phase}
      >
        {result ?? phase}
      </Text>
    </ScrollView>
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** Keep the status receipt short enough for device accessibility readback. */
function summary(
  value: Awaited<ReturnType<typeof runIssue189AppleWorkflowProbe>>,
): string {
  const cancellation = record(value.cancellation);
  const errorCodes = value.diagnostics.flatMap(item => {
    const code = record(record(record(item).result).error).code;
    return typeof code === 'string' ? [code] : [];
  });
  return JSON.stringify({
    availability: value.availability,
    calendar: record(value.calendar).status ?? value.calendar,
    nextVisit: record(value.nextVisit).status ?? value.nextVisit,
    cancellation: record(cancellation.result).status ?? value.cancellation,
    providerStarted: cancellation.providerStarted,
    abortSent: cancellation.abortSent,
    errorCodes: [...new Set(errorCodes)],
  }).slice(0, 500);
}

AppRegistry.registerComponent(appName, () => Issue189AppleWorkflowProbeEntry);
