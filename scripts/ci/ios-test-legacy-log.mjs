const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z /;
const terminal =
  /^Test Case '-\[([A-Za-z_][\w]*)\.([A-Za-z_][\w]*) (test[\w]+)\]' (passed|failed) \(([\d.]+) seconds\)\.$/;
const started = /^Test Case '-\[([A-Za-z_][\w]*)\.([A-Za-z_][\w]*) (test[\w]+)\]' started\.$/;
const diagnostic =
  /^.*\/(apps\/mobile\/ios\/(?:OrotIntegrationTests|OrotUITests)\/[^/:]+\.swift):(\d+): error: -\[([A-Za-z_][\w]*)\.([A-Za-z_][\w]*) (test[\w]+)\] : (.+)$/;

/** Recover only unambiguous terminal XCTest lines from the cohort executor's own step. */
export function recoverLegacyTaskObservations(log, tasks, expectedTasks, jobUrl, provenance = {}) {
  const rawLines = log.split('\n').filter((line) => timestamp.test(line));
  const lines = rawLines.map((line) => line.replace(timestamp, ''));
  const starts = lines.flatMap((line, index) =>
    line.startsWith('##[group]Run scripts/ci/run-command.sh ios-cohort-tests ') &&
    line.includes('scripts/ci/run-ios-test-cohort.mjs')
      ? [index]
      : [],
  );
  if (starts.length !== 1) return tasks;
  const start = starts[0] + 1;
  let end = lines.findIndex((line, index) => index >= start && line.startsWith('##[group]Run '));
  if (end < 0) return tasks;
  const observed = new Map();
  const diagnostics = new Map();
  const startsByCase = new Map();
  const failedCases = new Set();
  let active;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    const begin = line.match(started);
    if (begin) {
      const id = `${begin[1]}/${begin[2]}/${begin[3]}`;
      startsByCase.set(id, (startsByCase.get(id) ?? 0) + 1);
      active = active ? null : id;
      continue;
    }
    const failure = line.match(diagnostic);
    if (failure && active === `${failure[3]}/${failure[4]}/${failure[5]}`) {
      const id = `${failure[3]}/${failure[4]}/${failure[5]}`;
      const prior = diagnostics.get(id) ?? [];
      prior.push({
        message: failure[6],
        sourceLocation: { filePath: failure[1], lineNumber: Number(failure[2]) },
      });
      diagnostics.set(id, prior);
    }
    const match = line.match(terminal);
    if (!match) continue;
    const id = `${match[1]}/${match[2]}/${match[3]}`;
    if (match[4] === 'failed') failedCases.add(id);
    const prior = observed.get(id) ?? [];
    prior.push(
      active === id
        ? {
            identifier: id,
            result: match[4] === 'passed' ? 'Passed' : 'Failed',
            duration: Number(match[5]),
            evidence: {
              kind: 'actions-job-log',
              url: jobUrl,
              ...provenance,
              timestamp: rawLines[index].split(' ')[0],
              durationPrecision: 'rounded-seconds',
            },
          }
        : null,
    );
    observed.set(id, prior);
    active = undefined;
  }
  return tasks.map((task) => {
    if (task.status !== 'failed' || task.observations?.length || task.firstFailure) return task;
    const expected = expectedTasks.find(
      (item) => item.profile === task.profile && item.suite === task.suite,
    );
    if (!expected) return task;
    const recovered = [];
    // Log order is retained for the first failure; repeated or cross-task names remain unknown.
    for (const [id, entries] of observed) {
      if (
        entries.length !== 1 ||
        !entries[0] ||
        startsByCase.get(id) !== 1 ||
        !expected.identifiers.includes(id) ||
        expectedTasks.filter((item) => item.identifiers.includes(id)).length !== 1
      )
        continue;
      const observation = entries[0];
      const errors = diagnostics.get(id) ?? [];
      if (observation.result === 'Failed' && errors.length === 1) observation.failure = errors[0];
      recovered.push(observation);
    }
    const failedIds = [...failedCases].filter((id) => expected.identifiers.includes(id));
    const first = recovered.find(
      (item) => item.identifier === failedIds[0] && item.result === 'Failed',
    );
    return {
      ...task,
      observations: recovered,
      ...(first ? { firstFailure: first } : {}),
    };
  });
}

/** Read logs only for one verified source-attempt job and an exact, unique receipt. */
export async function recoverArchivedReports({
  reports,
  jobs,
  inventory,
  selectedCohorts,
  context,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  const plan = inventory.plan(selectedCohorts);
  const output = [];
  for (const entry of reports) {
    const report = entry.report;
    const matching = reports.filter((item) => item.report?.cohort === report?.cohort);
    const planned = plan.find((item) => item.cohort === report?.cohort);
    const candidates = jobs.filter((job) => job.name === `Test / ${planned?.name}`);
    const job = candidates[0];
    if (
      !planned ||
      matching.length !== 1 ||
      candidates.length !== 1 ||
      report.sourceSha !== context.sourceSha ||
      String(report.runId) !== String(context.runId) ||
      String(report.attempt) !== String(context.attempt) ||
      String(job.run_id) !== String(context.runId) ||
      String(job.run_attempt) !== String(context.attempt) ||
      job.head_sha !== context.sourceSha ||
      job.conclusion !== 'failure' ||
      !Number.isSafeInteger(job.id) ||
      !report.tasks?.some(
        (task) => task.status === 'failed' && !task.observations?.length && !task.firstFailure,
      )
    ) {
      output.push(entry);
      continue;
    }
    try {
      const url = `${apiUrl.replace(/\/$/, '')}/repos/${context.repository}/actions/jobs/${job.id}/logs`;
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('Job log unavailable');
      const log = await response.text();
      if (log.length > 20_000_000) throw new Error('Job log exceeds limit');
      const jobUrl = `${context.runUrl.replace(/\/attempts\/\d+$/, '')}/job/${job.id}`;
      const tasks = recoverLegacyTaskObservations(
        log,
        report.tasks,
        inventory.tasks(report.cohort),
        jobUrl,
        {
          jobId: job.id,
          sourceSha: context.sourceSha,
          runId: context.runId,
          attempt: context.attempt,
        },
      );
      output.push({ ...entry, report: { ...report, tasks } });
    } catch {
      // Unavailable or truncated logs never turn missing evidence into an observation.
      output.push(entry);
    }
  }
  return output;
}
