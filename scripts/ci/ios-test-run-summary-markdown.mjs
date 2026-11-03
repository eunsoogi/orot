const baseSafeText = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(
      /[|<>`]/g,
      (character) => ({ '|': '\\|', '<': '&lt;', '>': '&gt;', '`': '&#96;' })[character],
    )
    .replace(/\r?\n/g, ' ');
const elapsed = (value) => (Number.isFinite(value) ? `${(value / 1000).toFixed(1)} s` : 'Unknown');
const tally = (group) => `${group.selectedCount}/${group.expectedCount}`;
const link = (label, url) => (url ? `[${safeText(label)}](${safeText(url)})` : safeText(label));
const safeText = (value) =>
  baseSafeText(value)
    .replace(/\p{Cc}/gu, ' ')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
    .replaceAll('*', '&#42;')
    .replaceAll('_', '&#95;')
    .replaceAll('~', '&#126;')
    .replaceAll('!', '&#33;');

function renderCoverage(coverage) {
  const rows = [
    ['Ordinary iPhone', coverage.ordinaryIphone],
    ['Opt-in Duo', coverage.duo],
    ['Speech', coverage.speech],
    ['Authentication', coverage.authentication],
  ];
  const lines = [
    '| Surface | Selected / expected | Passed | Failed | Cancelled | Skipped | Unexecuted | Missing / duplicate / stale | Unknown |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [name, group] of rows) {
    const counts = group.counts;
    lines.push(
      `| ${name} | ${tally(group)} | ${counts.passed} | ${counts.failed} | ${counts.cancelled} | ${counts.skipped} | ${counts.unexecuted} | ${counts.missing + counts.duplicate + counts.stale} | ${counts.unknown} |`,
    );
  }
  lines.push(
    `| OAuth | ${coverage.oauth.selected ? 'selected' : 'not selected'} | execution: ${coverage.oauth.status}; product job: ${coverage.oauth.productsStatus} |  |  |  |  |  |  |`,
    `| Production | ${coverage.production.selected ? 'selected' : 'not selected'} | ${coverage.production.status} |  |  |  |  |  |  |`,
  );
  if (coverage.duo.selectionReason) lines.push('', safeText(coverage.duo.selectionReason));
  return lines;
}

function renderTiming(timing) {
  const preparation = timing?.preparation ?? {};
  const lines = [
    '### Timing',
    '',
    '| Measure | Duration |',
    '| --- | ---: |',
    `| Workflow wall time | ${elapsed(timing.workflowWallMs)} |`,
    `| Elapsed through report capture | ${elapsed(timing.elapsedThroughSummaryMs)} |`,
    `| Mac wall time | ${elapsed(timing.macWallMs)} |`,
    `| Total Mac occupancy | ${elapsed(timing.macOccupancyMs)} |`,
    `| Observed occupancy from completed Mac jobs | ${elapsed(timing.observedMacOccupancyMs)} |`,
    `| Queue wait | ${elapsed(timing.queueMs)} |`,
    `| Dependency delay | ${elapsed(timing.dependencyMs)} |`,
    `| Created-to-start delay (queue and dependency may both contribute) | ${elapsed(timing.jobStartDelayMs)} |`,
    `| Build steps | ${elapsed(timing.buildMs)} |`,
    `| UI preparation | ${elapsed(preparation.uiPreparationMs)} |`,
    `| UI bootstrap | ${elapsed(preparation.uiBootstrapMs)} |`,
    `| Speech asset preparation | ${elapsed(preparation.speechAssetPreparationMs)} |`,
    `| XCTest body time | ${elapsed(timing.testBodyMs)} |`,
    `| Executed cohort task time | ${elapsed(timing.taskElapsedMs)} |`,
    `| Simulator cleanup | ${elapsed(timing.cleanupMs)} |`,
  ];
  for (const note of [
    timing.workflowWallReason,
    timing.jobStartDelayNote,
    timing.dependencyTimingNote,
  ])
    if (note) lines.push('', safeText(note));
  if (!timing.testBodyComplete && Number.isFinite(timing.observedTestBodyMs))
    lines.push(
      `Observed XCTest body time is partial: ${elapsed(timing.observedTestBodyMs)} across ${timing.testDurationCaseCount} of ${timing.selectedCaseCount} selected cases.`,
    );
  if (!timing.taskElapsedComplete && Number.isFinite(timing.observedTaskElapsedMs))
    lines.push(
      `Observed cohort task time is partial: ${elapsed(timing.observedTaskElapsedMs)} across ${timing.taskElapsedTaskCount} of ${timing.expectedTaskElapsedTaskCount} planned tasks with timings.`,
    );
  if (timing.pendingMacJobs?.length)
    lines.push(
      `Mac jobs without complete timestamps: ${timing.pendingMacJobs.map(safeText).join(', ')}.`,
    );
  for (const cohort of preparation.missingUiCohorts ?? [])
    lines.push(`UI preparation timing is missing for ${safeText(cohort)}.`);
  for (const cohort of preparation.missingBootstrapCohorts ?? [])
    lines.push(`UI bootstrap timing is missing for ${safeText(cohort)}.`);
  return lines;
}

/** Rank known phases separately because parallel Mac jobs can overlap their durations. */
function renderSetupPhases(phases = []) {
  const longest = phases
    .filter((phase) => Number.isFinite(phase.durationMs))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5);
  return [
    '### Longest setup phases',
    '',
    ...(longest.length
      ? longest.map((phase) => `- ${safeText(phase.name)} - ${elapsed(phase.durationMs)}`)
      : ['No setup phase durations were available.']),
    '',
    'Setup phase durations are measured individually and may overlap across Mac jobs. Use Mac occupancy for total cost.',
  ];
}

function renderFailures(summary) {
  const lines = ['### First task failures', ''];
  if (!summary.firstFailures.length)
    lines.push("No first task failures were present in this attempt's artifacts.");
  else
    for (const item of summary.firstFailures) {
      const location = item.observation;
      const source = location?.sourceUrl ? `; ${link('source', location.sourceUrl)}` : '';
      const run = location?.runUrl ? `; ${link('run attempt', location.runUrl)}` : '';
      const time = Number.isFinite(item.elapsedMs)
        ? ` at ${elapsed(item.elapsedMs)} from cohort start`
        : '';
      if (!location) {
        const error = item.taskError ? `: ${safeText(item.taskError)}` : '';
        lines.push(
          `- ${safeText(item.cohort)} / ${safeText(item.profile)} / ${safeText(item.suite)}: task failed, first XCTest observation unavailable${error}.`,
        );
      } else {
        const message = location.failure?.message ? `: ${safeText(location.failure.message)}` : '';
        lines.push(
          `- \`${safeText(location.identifier)}\` (${safeText(item.cohort)} / ${safeText(item.profile)} / ${safeText(item.suite)})${time}${message}${source}${run}.`,
        );
      }
    }
  return lines;
}

function renderExceptions(summary) {
  const exceptions = summary.cases.filter((item) =>
    [
      'failed',
      'cancelled',
      'skipped',
      'unexecuted',
      'missing',
      'duplicate',
      'stale',
      'unknown',
    ].includes(item.status),
  );
  const lines = ['### Failed and incomplete cases', ''];
  if (!exceptions.length) lines.push('No failed or incomplete selected cases were reported.');
  else
    for (const item of exceptions) {
      const source = item.sourceUrl ? `; ${link('source', item.sourceUrl)}` : '';
      const reason = item.failure?.message ? `; ${safeText(item.failure.message)}` : '';
      const run = item.runUrl ? `; ${link('run attempt', item.runUrl)}` : '';
      lines.push(`- \`${safeText(item.identifier)}\` - ${item.status}${reason}${source}${run}`);
    }
  return lines;
}

function renderArtifactDiagnostics(summary) {
  const diagnostics = [
    ...(summary.reportReadErrors ?? []).map(
      (item) => `Could not read ${item.artifactName}: ${item.reason}`,
    ),
    ...(summary.staleReports ?? []).map(
      (item) => `Stale report: ${item.artifactName} (${item.cohort ?? 'unknown cohort'})`,
    ),
    ...(summary.unexpectedReports ?? []).map(
      (item) =>
        `Unexpected report: ${item.artifactName} (${item.reason ?? item.cohort ?? 'unknown cohort'})`,
    ),
    ...(summary.unexpectedObservations ?? []).map(
      (item) => `Unexpected observation: ${item.cohort} / ${item.identifier}`,
    ),
  ];
  return diagnostics.length
    ? ['### Artifact diagnostics', '', ...diagnostics.map((item) => `- ${safeText(item)}`)]
    : [];
}

/** Render a non-gating artifact report with exact attempt and source links. */
export function renderIosTestRunSummaryMarkdown(summary) {
  const { provenance, coverage } = summary;
  const timing = summary.timing ?? {};
  const publication = summary.publication;
  return [
    '## iOS test run report',
    '',
    ...(publication?.runUrl
      ? [
          'Published by: ' +
            link(
              'run ' + publication.runId + ' attempt ' + publication.attempt,
              publication.runUrl,
            ),
        ]
      : []),
    `Source: \`${safeText(provenance.sourceSha)}\`; ${link(`run ${provenance.runId} attempt ${provenance.attempt}`, provenance.runUrl)}`,
    `Validation tier: ${safeText(summary.selection.validationTier)}; full source inventory selected: ${summary.selection.fullInventorySelected ? 'yes' : 'no'}.`,
    '',
    ...renderCoverage(coverage),
    '',
    ...renderTiming(timing),
    '',
    ...renderSetupPhases(timing.setupPhases),
    '',
    ...renderFailures(summary),
    '',
    ...renderExceptions(summary),
    '',
    ...renderArtifactDiagnostics(summary),
    '',
    '### Longest observed cases',
    '',
    ...(summary.expensiveCases.length
      ? summary.expensiveCases.map(
          (item) =>
            `- \`${safeText(item.identifier)}\` - ${elapsed(item.durationMs)} (${item.status})`,
        )
      : ['No case durations were available.']),
    '',
    '### Longest reported tasks',
    '',
    ...(summary.expensiveTasks.length
      ? summary.expensiveTasks.map(
          (item) =>
            `- ${safeText(item.cohort)} / ${safeText(item.profile)} / ${safeText(item.suite)} - ${elapsed(item.elapsedMs)} (${item.status})`,
        )
      : ['No task elapsed times were available.']),
    '',
  ].join('\n');
}
