import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { hostConnectionTest } from '../ios-test-preparation-contract.mjs';

// Use the already-pinned ESLint YAML parser; this graph check adds no dependency or runner installation.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (file) => yaml.load(readFileSync(file, 'utf8'));

function macJobs(file) {
  return Object.values(workflow(file).jobs).reduce((count, job) => {
    assert.equal(
      job.strategy?.matrix,
      undefined,
      'integration Mac jobs must not fan out by test/group',
    );
    if (job.uses) return count + macJobs(job.uses.replace(/^\.\//, ''));
    return count + (job['runs-on'] === 'xcode-27' ? 1 : 0);
  }, 0);
}

test('verified Release availability releases three consumers without waiting for unrelated tests', () => {
  const full = workflow('.github/workflows/ios-test-validation.yml');
  assert.equal(macJobs('.github/workflows/ios-test-validation.yml'), 5);
  assert.equal(full.jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.release_products.needs, 'plan');
  const consumers = ['release_core', 'release_ui', 'speech_execution'];
  for (const id of consumers) {
    assert.deepEqual(full.jobs[id].needs, ['plan', 'release_products']);
    assert.equal(full.jobs[id].if, undefined);
    assert.equal(
      full.jobs[id].with.archive_digest,
      '${{ needs.release_products.outputs.archive_digest }}',
    );
    assert.equal(
      full.jobs[id].with.manifest_digest,
      '${{ needs.release_products.outputs.manifest_digest }}',
    );
  }
  assert.equal(full.jobs.debug_execution.needs, 'plan');
  assert.equal(full.jobs.release_products.with.profile, 'core');
  assert.equal(full.jobs.debug_execution.with.profile, 'provider-data');
  // Enumerate possible overlap states in the Mac dependency graph, rather than relying only on a max-parallel setting.
  const ids = ['release_products', 'debug_execution', ...consumers];
  const ancestors = (id) => {
    const needs = full.jobs[id].needs ?? [];
    return (Array.isArray(needs) ? needs : [needs]).flatMap((dependency) => [
      dependency,
      ...ancestors(dependency),
    ]);
  };
  let maximum = 0;
  for (let bits = 0; bits < 1 << ids.length; bits++) {
    const active = ids.filter((_, index) => bits & (1 << index));
    if (
      active.every((id) => {
        // Completed production/build work unblocks consumers even while Debug is executing.
        return !ancestors(id).some((dependency) => active.includes(dependency));
      })
    )
      maximum = Math.max(maximum, active.length);
  }
  assert.equal(maximum, 4);
  for (const id of ids) {
    assert.ok(full.jobs.completeness.needs.includes(id));
    assert.equal(full.jobs[id].if, undefined);
  }
  assert.equal(full.jobs.completeness.needs.length, 5);
  assert.ok(ancestors('speech_execution').includes('release_products'));
  assert.ok(!ancestors('speech_execution').includes('debug_execution'));
});

test('manual focused diagnostics reuse one configuration and do not allocate Mac slots for selection/results', () => {
  const focus = workflow('.github/workflows/ios-focused.yml');
  assert.equal(macJobs('.github/workflows/ios-focused.yml'), 2);
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.products.needs, 'selection');
  assert.equal(focus.jobs.execution.needs, 'products');
});

test('Release product availability never boots a simulator and retains production receipts on failure', () => {
  const producer = workflow('.github/workflows/ios-test-products-build.yml');
  const steps = producer.jobs.validation.steps;
  assert.equal(
    steps.filter((step) => step.uses === './.github/actions/ios-test-products-build').length,
    1,
  );
  assert.ok(steps.every((step) => step.uses !== './.github/actions/ios-test-cohort-run'));
  assert.doesNotMatch(JSON.stringify(steps), /prepare-cohort|run-ios-tests|test-without-building/);
  const publication = steps.find(
    (step) => step.with?.path === 'artifacts/ios-focus/product-artifact',
  );
  assert.equal(publication.if, undefined);
  assert.equal(publication.with['if-no-files-found'], 'error');
  const receipt = steps.find(
    (step) => step.with?.path === 'artifacts/ios-focus/production-receipt.json',
  );
  assert.equal(receipt.if, '${{ always() && inputs.production_build }}');
  const action = workflow('.github/actions/ios-test-cohort-run/action.yml');
  const rejection = action.runs.steps.find((step) =>
    step.run?.includes('probe-ios-test-products.mjs'),
  );
  assert.equal(rejection.if, "inputs.cohort == 'release' || inputs.cohort == 'release-core'");
});

test('the full gate rejects failure, cancellation, skip and missing results from each producer or consumer', () => {
  const full = workflow('.github/workflows/ios-test-validation.yml');
  const gate = full.jobs.completeness.steps.find((step) => step.env?.RESULTS);
  assert.equal(full.jobs.completeness.if, 'always()');
  const evaluate = new Function('process', gate.run.slice("node -e '".length, -1));
  const success = Object.fromEntries(
    full.jobs.completeness.needs.map((id) => [id, { result: 'success' }]),
  );
  assert.doesNotThrow(() => evaluate({ env: { RESULTS: JSON.stringify(success) } }));
  for (const id of full.jobs.completeness.needs) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const changed = { ...success, [id]: { result } };
      assert.throws(() => evaluate({ env: { RESULTS: JSON.stringify(changed) } }));
    }
  }
});

test('every cohort boots only once after verification and preserves the original test, failure and production boundaries', () => {
  const consumer = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.equal((consumer.match(/ios-test-simulator\.mjs prepare-cohort/g) ?? []).length, 1);
  assert.ok(
    consumer.indexOf('Verify configuration, source and product integrity before boot') <
      consumer.indexOf('prepare-cohort'),
  );
  assert.match(consumer, /if: always\(\)[\s\S]*ios-test-simulator\.mjs cleanup/);
  assert.doesNotMatch(consumer, /continue-on-error|build-ios-tests\.mjs|test-iterations/);
  const action = readFileSync('.github/actions/ios-test-products-build/action.yml', 'utf8');
  assert.match(action, /build-ios-simulator-app\.sh build/);
  assert.match(action, /swift test --package-path packages\/provider-openai/);
  assert.match(action, /orot-openai-oauth-derived/);
  const productWorkflow = workflow('.github/workflows/ios-test-build-and-execute.yml');
  const composite = yaml.load(action);
  // Production cache validation needs every toolchain field even on a fresh cache miss.
  for (const step of composite.runs.steps.filter((step) =>
    /ios-derived-data-cache\.mjs (prepare|write) production/.test(step.run ?? ''),
  )) {
    const environment = { ...productWorkflow.env, ...step.env };
    for (const name of [
      'IOS_CACHE_RUNNER_OS',
      'IOS_CACHE_RUNNER_ARCH',
      'MACOS_VERSION',
      'EXPECTED_NODE_VERSION',
      'EXPECTED_PNPM_VERSION',
      'EXPECTED_RUBY_VERSION',
      'EXPECTED_COCOAPODS_VERSION',
      'EXPECTED_XCODE_VERSION',
      'EXPECTED_IOS_SIMULATOR_SDK',
      'XCODEBUILD_FINGERPRINT',
    ])
      assert.ok(environment[name], 'Missing production toolchain input: ' + name);
  }
  assert.match(action, /build-ios-tests\.mjs "\$PROFILE" artifacts\/ios-focus\/DerivedData/);
  assert.equal(
    new Set(
      ['release', 'speech', 'debug'].flatMap((name) =>
        iosTestCohortTasks(name).flatMap((task) => task.identifiers),
      ),
    ).size,
    82,
  );
});

test('production rejects mismatched actual tools before cache preparation, Pods and either build', () => {
  const action = workflow('.github/actions/ios-test-products-build/action.yml');
  const steps = action.runs.steps;
  const guard = steps.findIndex((step) => /verify-toolchain\.sh --cocoapods/.test(step.run ?? ''));
  assert.ok(guard >= 0, 'Actual production tools must be verified');
  assert.equal(steps[guard].if, "inputs.production_build == 'true'");
  assert.equal(steps[guard]['continue-on-error'], undefined);
  for (const command of [
    'ios-derived-data-cache.mjs prepare production',
    'ios:pods',
    'build-ios-simulator-app.sh build',
    'swift test --package-path',
    'build-ios-tests.mjs',
  ])
    assert.ok(guard < steps.findIndex((step) => (step.run ?? '').includes(command)), command);
});

test('removing duplicated GUI preflight retains the original host case and first-failure artifacts', () => {
  assert.ok(iosTestInventory('core').includes(hostConnectionTest));
  const action = readFileSync('.github/actions/ios-test-cohort-run/action.yml', 'utf8');
  assert.doesNotMatch(action, /prepare-ios-test-ui|DeviceHub|host-preparation\.xcresult/);
  const execution = workflow('.github/actions/ios-test-cohort-run/action.yml');
  const upload = execution.runs.steps.find(
    (step) => step.name === 'Preserve all first-attempt diagnostics',
  );
  assert.equal(upload.if, 'always()');
  assert.ok(upload.with.path.split('\n').includes('artifacts/ios-cohort/results'));
  const combined = workflow('.github/workflows/ios-test-build-and-execute.yml');
  const diagnostics = combined.jobs.validation.steps.find((step) =>
    step.name?.startsWith('Preserve build diagnostics'),
  );
  assert.equal(diagnostics.if, 'always()');
  assert.ok(diagnostics.with.path.split('\n').includes('artifacts/ios-focus/*.log'));
});

test('colocated builds are verified locally and all integration routes share one live-run budget', () => {
  const combined = workflow('.github/workflows/ios-test-build-and-execute.yml');
  const steps = combined.jobs.validation.steps;
  assert.equal(
    steps.filter((step) => step.uses === './.github/actions/ios-test-products-build').length,
    1,
  );
  assert.equal(
    steps.filter((step) => step.uses === './.github/actions/ios-test-cohort-run').length,
    1,
  );
  assert.ok(steps.every((step) => !step.uses?.startsWith('actions/download-artifact@')));
  const concurrency = workflow('.github/workflows/ios-test-validation.yml').concurrency;
  assert.equal(concurrency.group, 'ios-ci-macos-${{ github.repository }}');
  assert.equal(concurrency['cancel-in-progress'], false);
  const focused = workflow('.github/workflows/ios-focused.yml');
  for (const name of ['products', 'execution']) {
    assert.equal(focused.jobs[name].concurrency.group, 'ios-ci-macos-${{ github.repository }}');
    assert.equal(focused.jobs[name].concurrency['cancel-in-progress'], false);
  }
});
