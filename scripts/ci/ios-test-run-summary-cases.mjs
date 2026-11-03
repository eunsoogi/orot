import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { iosTestCohortTasks } from './ios-test-cohorts.mjs';
import { iosTestInventory } from './ios-test-inventory.mjs';

/** Keep artifact observations distinct from the stricter first-attempt gate. */
export function exactReport(report, context) {
  return (
    typeof context?.sourceSha === 'string' &&
    context.sourceSha.length > 0 &&
    report?.sourceSha === context.sourceSha &&
    context.runId != null &&
    context.attempt != null &&
    String(report?.runId) === String(context.runId) &&
    String(report?.attempt) === String(context.attempt)
  );
}

export function observationStatus(result) {
  if (result === 'Passed') return 'passed';
  if (result === 'Failed' || result === 'Expected Failure') return 'failed';
  if (result === 'Skipped') return 'skipped';
  if (['Cancelled', 'Canceled'].includes(result)) return 'cancelled';
  return 'unknown';
}

export function jobStatus(result) {
  if (result === 'success') return 'passed';
  if (result === 'failure') return 'failed';
  if (result === 'cancelled') return 'cancelled';
  if (result === 'skipped') return 'skipped';
  return 'unexecuted';
}

/** Count every planned row once, including explicit non-selected and unknown rows. */
export function countStatuses(cases) {
  return Object.fromEntries(
    [
      'passed',
      'failed',
      'cancelled',
      'skipped',
      'unexecuted',
      'missing',
      'duplicate',
      'stale',
      'not-selected',
      'unknown',
    ].map((status) => [status, cases.filter((item) => item.status === status).length]),
  );
}

/** Prefer an observed failure line; only use the maintained test class for non-failure case links. */
function sourceUrl(identifier, context, root, failure) {
  const location = failure?.sourceLocation;
  const locationPath =
    typeof location?.filePath === 'string' ? location.filePath.replaceAll('\\', '/') : '';
  const validLocation =
    locationPath &&
    !locationPath.startsWith('/') &&
    !locationPath.split('/').includes('..') &&
    !locationPath.includes('\0') &&
    Number.isInteger(location.lineNumber) &&
    location.lineNumber > 0;
  const { serverUrl, repository, sourceSha } = context ?? {};
  if (
    !serverUrl ||
    !repository ||
    !/^[a-f0-9]{40}$/i.test(sourceSha ?? '') ||
    !/^[^/\s]+\/[^/\s]+$/.test(repository)
  )
    return undefined;
  const baseUrl = serverUrl.replace(/\/$/, '');
  if (validLocation)
    return `${baseUrl}/${repository}/blob/${sourceSha}/${locationPath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}#L${location.lineNumber}`;
  if (typeof identifier !== 'string') return undefined;
  const [target, className] = identifier.split('/');
  if (
    !['OrotIntegrationTests', 'OrotUITests'].includes(target) ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(className ?? '')
  )
    return undefined;
  const directory = target === 'OrotIntegrationTests' ? 'OrotIntegrationTests' : 'OrotUITests';
  const base = join(root, 'apps/mobile/ios', directory, className ?? '');
  const file = ['.swift', '.m', '.mm'].map((extension) => base + extension).find(existsSync);
  if (!file || !className) return undefined;
  const path = `apps/mobile/ios/${directory}/${className}${file.slice(base.length)}`;
  return `${baseUrl}/${repository}/blob/${sourceSha}/${path}`;
}

/** Add repository and run links without inventing locations for missing observations. */
export function makeCase(
  category,
  cohort,
  identifier,
  status,
  context,
  root,
  observation,
  details = {},
) {
  const failure = observation?.failure;
  const source = sourceUrl(identifier, context, root, failure);
  return {
    category,
    cohort,
    identifier,
    status,
    ...(observation?.result ? { observedResult: observation.result } : {}),
    ...(observation?.evidence ? { evidence: observation.evidence } : {}),
    ...(Number.isFinite(observation?.duration) ? { durationMs: observation.duration * 1000 } : {}),
    ...(failure ? { failure } : {}),
    ...(source ? { sourceUrl: source } : {}),
    ...(context?.runUrl ? { runUrl: context.runUrl } : {}),
    ...details,
  };
}

/** Match observations to the maintained cohort inventory and retain every gap. */
export function caseReport(
  entry,
  report,
  category,
  context,
  root,
  jobResults,
  tasks = iosTestCohortTasks,
) {
  const expected = tasks(entry.cohort);
  const observations = new Map();
  for (const task of report?.tasks ?? [])
    for (const observation of task.observations ?? []) {
      const values = observations.get(observation.identifier) ?? [];
      values.push(observation);
      observations.set(observation.identifier, values);
    }
  const executor = entry.configuration === 'Debug' ? 'debug_execution' : 'release_execution';
  // Prefer a cohort-specific job outcome when its receipt is missing.
  const fallbackStatus = jobStatus(
    jobResults?.cohorts?.[entry.cohort]?.result ?? jobResults?.[executor]?.result,
  );
  const cases = expected.flatMap((task) =>
    task.identifiers.map((identifier) => {
      const found = observations.get(identifier) ?? [];
      if (found.length > 1)
        return makeCase(category, entry.cohort, identifier, 'duplicate', context, root, undefined, {
          observationCount: found.length,
        });
      if (found.length === 1)
        return makeCase(
          category,
          entry.cohort,
          identifier,
          observationStatus(found[0].result),
          context,
          root,
          found[0],
        );
      const taskResult = (report?.tasks ?? []).find(
        (item) => item.profile === task.profile && item.suite === task.suite,
      );
      const taskStatus = taskResult?.status;
      let status =
        taskStatus === 'failed' ? 'unknown' : taskStatus === 'not-run' ? 'unexecuted' : 'missing';
      // A successful producer without its exact attempt artifact is missing evidence, not execution.
      if (!report)
        status =
          fallbackStatus === 'cancelled' || fallbackStatus === 'skipped'
            ? fallbackStatus
            : fallbackStatus === 'passed'
              ? 'missing'
              : 'unknown';
      return makeCase(category, entry.cohort, identifier, status, context, root, undefined, {
        ...(taskStatus ? { taskStatus } : {}),
      });
    }),
  );
  const expectedIds = new Set(expected.flatMap((task) => task.identifiers));
  const unexpected = [...observations.keys()].filter((identifier) => !expectedIds.has(identifier));
  return { cases, tasks: report?.tasks ?? [], unexpected };
}

/** Authentication is a separate product and receipt, so absent evidence stays explicit. */
export function authenticationCases(
  report,
  selected,
  context,
  root,
  jobResults,
  inventory = iosTestInventory,
) {
  const identifiers = inventory('core', 'authentication');
  const observations = new Map();
  for (const observation of report?.observations ?? []) {
    const values = observations.get(observation.identifier) ?? [];
    values.push(observation);
    observations.set(observation.identifier, values);
  }
  return identifiers.map((identifier) => {
    if (!selected)
      return makeCase(
        'authentication',
        'authentication',
        identifier,
        'not-selected',
        context,
        root,
      );
    const found = observations.get(identifier) ?? [];
    if (found.length > 1)
      return makeCase(
        'authentication',
        'authentication',
        identifier,
        'duplicate',
        context,
        root,
        undefined,
        {
          observationCount: found.length,
        },
      );
    if (found.length === 1)
      return makeCase(
        'authentication',
        'authentication',
        identifier,
        observationStatus(found[0].result),
        context,
        root,
        found[0],
      );
    const status = jobStatus(jobResults?.authentication?.result);
    // A successful job without its receipt is a missing artifact. Failed or unknown jobs
    // provide no case-level execution evidence.
    const caseStatus = report
      ? 'missing'
      : ['cancelled', 'skipped'].includes(status)
        ? status
        : status === 'passed'
          ? 'missing'
          : 'unknown';
    return makeCase('authentication', 'authentication', identifier, caseStatus, context, root);
  });
}
