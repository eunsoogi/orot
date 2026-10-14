import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';

// Use the already-pinned ESLint YAML parser; this graph check adds no dependency or runner installation.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const workflow = (file) => yaml.load(readFileSync(file, 'utf8'));

function macJobs(file) {
  return Object.values(workflow(file).jobs).reduce((count, job) => {
    assert.equal(job.strategy?.matrix, undefined, 'native Mac jobs must not fan out by test/group');
    if (job.uses) return count + macJobs(job.uses.replace(/^\.\//, ''));
    return count + (job['runs-on'] === 'xcode-27' ? 1 : 0);
  }, 0);
}

test('full native graph has five primary Mac jobs plus two sequential fresh samples and leaves planning and aggregation on Linux', () => {
  const full = workflow('.github/workflows/ios-test-validation.yml');
  assert.equal(macJobs('.github/workflows/ios-test-validation.yml'), 7);
  assert.equal(full.jobs.plan['runs-on'], 'ubuntu-24.04');
  assert.equal(full.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.deepEqual(full.jobs.release_execution.needs, ['plan', 'release_products']);
  assert.deepEqual(full.jobs.speech_execution.needs, ['plan', 'release_products']);
  assert.deepEqual(full.jobs.debug_execution.needs, ['plan', 'debug_products']);
  assert.equal(full.jobs.release_products.with.profile, 'core');
  assert.equal(full.jobs.debug_products.with.profile, 'provider-data');
  // Enumerate possible overlap states in the Mac dependency graph, rather than relying only on a max-parallel setting.
  const ids = [
    'release_products',
    'debug_products',
    'release_execution',
    'speech_execution',
    'debug_execution',
    'speech_sample_2',
    'speech_sample_3',
  ];
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
        // A later fresh sample cannot overlap any earlier prerequisite, including through the intervening sample.
        return !ancestors(id).some((dependency) => active.includes(dependency));
      })
    )
      maximum = Math.max(maximum, active.length);
  }
  assert.equal(maximum, 3);
});

test('manual focused and standalone Debug paths reuse one configuration and do not allocate Mac slots for selection/results', () => {
  const focus = workflow('.github/workflows/ios-native-focused.yml');
  assert.equal(macJobs('.github/workflows/ios-native-focused.yml'), 2);
  assert.equal(focus.jobs.selection['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.completeness['runs-on'], 'ubuntu-24.04');
  assert.equal(focus.jobs.products.needs, 'selection');
  assert.equal(focus.jobs.execution.needs, 'products');
  assert.equal(macJobs('.github/workflows/ios-debug-test-validation.yml'), 2);
});

test('every cohort boots only once after verification and preserves the original test, failure and production boundaries', () => {
  const consumer = readFileSync('.github/workflows/ios-test-cohort-execution.yml', 'utf8');
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
  const productWorkflow = workflow('.github/workflows/ios-test-product-build.yml');
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
  assert.match(action, /build-ios-tests\.mjs "\$PROFILE" artifacts\/native-focus\/DerivedData/);
  assert.equal(
    new Set(
      ['release', 'speech', 'debug'].flatMap((name) =>
        iosTestCohortTasks(name).flatMap((task) => task.identifiers),
      ),
    ).size,
    77,
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

test('preparation failure preserves its raw bundle even when cohort results do not exist', () => {
  const execution = workflow('.github/workflows/ios-test-cohort-execution.yml');
  const upload = execution.jobs.execution.steps.find(
    (step) => step.name === 'Preserve all first-attempt diagnostics',
  );
  assert.equal(upload.if, 'always()');
  // Preparation lives outside results/, so that directory alone cannot retain its first failure.
  assert.ok(upload.with.path.split('\n').includes('artifacts/ios-cohort/*.xcresult'));
});
