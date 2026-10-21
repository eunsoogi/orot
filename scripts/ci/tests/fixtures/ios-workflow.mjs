import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

export const workflow = (path) => yaml.load(readFileSync(path, 'utf8'));

/** Follow actual job dependencies when measuring which independent leaves can run together. */
function ancestors(jobs, id) {
  const needs = jobs[id].needs;
  const dependencies = typeof needs === 'string' ? [needs] : (needs ?? []);
  return dependencies.flatMap((dependency) => [dependency, ...ancestors(jobs, dependency)]);
}

/** Enumerate independent producer families while retaining each nested leaf's scheduling weight. */
export function maximumConcurrentJobWeight(jobs, ids, weight) {
  let maximum = 0;
  for (let bits = 0; bits < 1 << ids.length; bits++) {
    const active = ids.filter((_, index) => bits & (1 << index));
    if (
      active.every((id) => !ancestors(jobs, id).some((dependency) => active.includes(dependency)))
    )
      maximum = Math.max(
        maximum,
        active.reduce((sum, id) => sum + weight(id), 0),
      );
  }
  return maximum;
}

/** Follow the two producer-specific calls without hiding their caller or leaf dependency boundaries. */
export function cohortJobs(jobs) {
  const action = './.github/actions/ios-test-cohort-executor';
  const defaults = Object.fromEntries(
    Object.entries(workflow(action + '/action.yml').inputs).map(([key, input]) => [
      key,
      input.default,
    ]),
  );
  return Object.entries(jobs).flatMap(([callerId, caller]) => {
    if (!/ios-(debug|release)-tests\.yml$/.test(caller.uses ?? '')) return [];
    const leaves = Object.entries(workflow(caller.uses).jobs).flatMap(([id, leaf]) =>
      /^\.\/\.github\/workflows\/ios-(question|navigation|calendar)-tests\.yml$/.test(
        leaf.uses ?? '',
      )
        ? Object.entries(workflow(leaf.uses).jobs)
        : [[id, leaf]],
    );
    return leaves.map(([id, leaf]) => {
      const execution = leaf.steps.find((step) => step.uses === action);
      const inputs = { ...defaults, ...execution.with };
      for (const [key, value] of Object.entries(inputs))
        if (typeof value === 'string')
          inputs[key] = value.replace(/\$\{\{ inputs\.(\w+) \}\}/g, (_, name) => caller.with[name]);
      return [id, { callerId, caller, leaf, inputs }];
    });
  });
}

export const completionJob = (jobs) => workflow(jobs.completeness.uses).jobs.completeness;

/** Inspect the executed local-action order, including shared toolchain and Pods preparation. */
export function expandedActionSteps(path) {
  return workflow(path).runs.steps.flatMap((step) =>
    step.uses?.startsWith('./.github/actions/')
      ? expandedActionSteps(step.uses + '/action.yml')
      : [step],
  );
}
