import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('eslint/package.json'))('js-yaml');

export const workflow = (path) => yaml.load(readFileSync(path, 'utf8'));

/** Inspect the executed local-action order, including shared toolchain and Pods preparation. */
export function expandedActionSteps(path) {
  return workflow(path).runs.steps.flatMap((step) =>
    step.uses?.startsWith('./.github/actions/')
      ? expandedActionSteps(step.uses + '/action.yml')
      : [step],
  );
}
