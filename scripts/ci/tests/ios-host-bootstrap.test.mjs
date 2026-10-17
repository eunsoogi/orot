import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { expandedActionSteps, workflow } from './fixtures/ios-workflow.mjs';
import { suppressHostedSpotlight } from '../suppress-hosted-spotlight.mjs';

function runnerLabels(job) {
  const value = job['runs-on'];
  const raw = value?.labels ?? value;
  const labels = Array.isArray(raw) ? raw : [raw];
  return labels.flatMap((label) => {
    const matrix = /^\$\{\{\s*matrix\.(\w+)\s*\}\}$/.exec(label ?? '');
    if (!matrix) {
      assert.ok(!String(label).includes('${{'), 'Unclassified runner expression');
      return [label];
    }
    const definition = job.strategy?.matrix;
    const axis = definition?.[matrix[1]];
    const included =
      definition?.include?.flatMap((entry) =>
        entry[matrix[1]] === undefined ? [] : [entry[matrix[1]]],
      ) ?? [];
    assert.ok(
      (axis === undefined || Array.isArray(axis)) && (axis?.length || included.length),
      'Runner matrix must expose all runner labels',
    );
    return [...(axis ?? []), ...included].flat();
  });
}

function expandedSteps(steps) {
  return steps.flatMap((step) =>
    step.uses?.startsWith('./.github/actions/')
      ? expandedActionSteps(step.uses + '/action.yml')
      : [step],
  );
}

test('every declared macOS route disables and verifies Spotlight immediately after checkout', () => {
  const routes = [];
  // Reading every reusable definition also covers leaves reached by full, focused and future callers.
  for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
    for (const [id, job] of Object.entries(workflow('.github/workflows/' + file).jobs)) {
      if (job.uses) continue;
      const labels = runnerLabels(job);
      if (!labels.some((label) => /^(?:macos(?:-|$)|xcode-)/i.test(label))) continue;
      const steps = expandedSteps(job.steps);
      const checkout = steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'));
      const spotlight = steps.findIndex((step) =>
        step.run?.includes('suppress-hosted-spotlight.mjs'),
      );
      routes.push(file + '/' + id);
      assert.ok(checkout >= 0, 'Missing source checkout: ' + routes.at(-1));
      const visibleCheckout = job.steps.findIndex((step) =>
        step.uses?.startsWith('actions/checkout@'),
      );
      const visibleBootstrap = job.steps[visibleCheckout + 1];
      // The Actions step list must expose this setup even when the build uses nested composites.
      assert.equal(
        visibleBootstrap?.name,
        'Disable and verify Spotlight',
        'Host setup must be visible immediately after checkout: ' + routes.at(-1),
      );
      assert.equal(visibleBootstrap.uses, './.github/actions/ios-host-bootstrap');
      assert.equal(visibleBootstrap.if, undefined);
      assert.equal(visibleBootstrap['continue-on-error'], undefined);
      assert.equal(
        steps.filter((step) => step.run?.includes('suppress-hosted-spotlight.mjs')).length,
        1,
        'Host setup must execute exactly once: ' + routes.at(-1),
      );
      assert.equal(
        spotlight,
        checkout + 1,
        'Host setup must precede all tool/dependency setup: ' + routes.at(-1),
      );
      assert.equal(steps[spotlight].if, undefined);
      assert.equal(steps[spotlight]['continue-on-error'], undefined);
    }
  }
  assert.ok(routes.length > 0, 'No native workflow routes were audited');
});

test('matrix runner classification includes every macOS branch and rejects hidden expressions', () => {
  assert.deepEqual(
    runnerLabels({
      'runs-on': '${{ matrix.os }}',
      strategy: { matrix: { os: ['ubuntu-24.04', 'macos-15'] } },
    }),
    ['ubuntu-24.04', 'macos-15'],
  );
  assert.deepEqual(
    runnerLabels({
      'runs-on': { labels: '${{ matrix.runner }}' },
      strategy: {
        matrix: { include: [{ runner: 'ubuntu-24.04' }, { runner: ['self-hosted', 'macOS'] }] },
      },
    }),
    ['ubuntu-24.04', 'self-hosted', 'macOS'],
  );
  assert.throws(() => runnerLabels({ 'runs-on': '${{ inputs.runner }}' }));
});

test('an ephemeral Mac with failed Spotlight readback cannot report a successful bootstrap', () => {
  const env = {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'macOS',
    RUNNER_ENVIRONMENT: 'github-hosted',
  };
  const events = [];
  assert.throws(
    () =>
      suppressHostedSpotlight({
        env,
        platform: 'darwin',
        report: (event) => events.push(event),
        execute: () => ({ status: 1, stdout: '', stderr: 'operation failed' }),
      }),
    /Spotlight/,
  );
  assert.equal(events.at(-1).outcome, 'attempted-unverified');
});
