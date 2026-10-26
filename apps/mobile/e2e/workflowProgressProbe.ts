import {
  runMultiAgentWorkflow,
  type MultiAgentProgressEvent,
  type MultiAgentResponderStreamEvent,
} from '@orot/agent-runtime';
import { createWorkflowProgressFixture } from './workflowProgressFixture';

function progressTrace(events: readonly MultiAgentProgressEvent[]): string[] {
  return events.map(event =>
    event.type === 'model_started'
      ? `model_started:${event.phase}`
      : `evidence_search:${event.status}:${event.sourceKind}`,
  );
}

function displayedText(
  events: readonly MultiAgentResponderStreamEvent[],
): string {
  return events.reduce(
    (current, event) =>
      event.type === 'started'
        ? ''
        : event.type === 'text_delta'
          ? current + event.text
          : event.text,
    '',
  );
}

const ensure = (condition: boolean, label: string) => {
  if (!condition) throw new Error('Workflow progress probe failed: ' + label);
};

/** Runs the real graph under Hermes with synthetic provider responses and local search results only. */
export async function runWorkflowProgressProbe() {
  const successProgress: MultiAgentProgressEvent[] = [];
  const successStream: MultiAgentResponderStreamEvent[] = [];
  const fixture = createWorkflowProgressFixture('hermes-progress-success');
  const successRun = runMultiAgentWorkflow(fixture.options, {
    onProgress: event => successProgress.push(event),
    onTaskStreamEvent: event => successStream.push(event),
  });
  ensure(
    await Promise.race([
      fixture.snapshotReached.then(() => true),
      successRun.then(() => false),
    ]),
    'final snapshot reached',
  );
  const partialVisibleBeforeCompletion = successStream.some(
    event => event.type !== 'started',
  );
  fixture.releaseSnapshot();
  const success = await successRun;

  const successTrace = progressTrace(successProgress);
  const projected = displayedText(successStream);
  const safeProjection =
    !JSON.stringify(successProgress).includes('Private synthetic') &&
    !JSON.stringify(successStream).includes('synthetic-progress-evidence') &&
    !JSON.stringify(successStream).includes('citations');
  ensure(success.status === 'result', 'successful workflow result');
  ensure(
    !partialVisibleBeforeCompletion,
    'buffered snapshots stay private until completion',
  );
  ensure(projected === 'Synthetic answer.', 'approved final text projection');
  ensure(
    safeProjection,
    'private request and evidence details stay outside observer events',
  );
  return {
    synthetic: true,
    modelExecution: 'scripted',
    actualModel: 'not-run',
    successStatus: success.status,
    successProgress: successTrace,
    streamTypes: successStream.map(event => event.type),
    projectedText: projected,
    partialVisibleBeforeCompletion,
    privatePayloadExposed: !safeProjection,
  };
}
