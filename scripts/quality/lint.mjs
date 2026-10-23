import { resolve } from 'node:path';
import { createQualityTools, filesFor } from './process.mjs';

const actionlintQueueWorkflows = new Set([
  '.github/workflows/e2e-test.yml',
  '.github/workflows/e2e-selected.yml',
]);
const actionlintQueueDiagnostic = 'unexpected key "queue" for "concurrency" section';

/** Keep all workflows linted while isolating the pinned parser's unsupported queue-key warning. */
export function actionlintInvocationArgs(workflows) {
  const standard = workflows.filter((path) => !actionlintQueueWorkflows.has(path));
  const queued = workflows.filter((path) => actionlintQueueWorkflows.has(path));
  return [
    ...(standard.length ? [standard] : []),
    ...(queued.length ? [['-ignore', actionlintQueueDiagnostic, ...queued]] : []),
  ];
}

export function runLint({ entries, env, clang, binaryPaths, root }) {
  const { invoke } = createQualityTools(root);
  const workspaceFiles = entries
    .filter(
      (entry) => entry.kind === 'surface' && ['javascript', 'typescript'].includes(entry.surface),
    )
    .filter((entry) => entry.path.startsWith('apps/mobile/') || entry.path.startsWith('packages/'))
    .map((entry) => resolve(root, entry.path));
  if (workspaceFiles.length > 0) {
    // Explicit inventory paths include files package-level lint scripts omit.
    // Keep both local and CI ESLint runs from treating warnings as successful checks.
    invoke(
      'pnpm',
      [
        '--filter',
        '@orot/mobile',
        'exec',
        'eslint',
        '--max-warnings',
        '0',
        '--config',
        resolve(root, 'apps/mobile/.eslintrc.js'),
        '--no-ignore',
        ...workspaceFiles,
      ],
      env,
    );
  }

  const rootJavascript = entries
    .filter(
      (entry) => entry.kind === 'surface' && ['javascript', 'typescript'].includes(entry.surface),
    )
    .map((entry) => entry.path)
    .filter((path) => !path.startsWith('apps/mobile/') && !path.startsWith('packages/'))
    .filter((path) =>
      ['.js', '.jsx', '.mjs', '.cjs'].some((extension) => path.endsWith(extension)),
    );
  if (rootJavascript.length > 0) {
    invoke(
      'pnpm',
      [
        'exec',
        'eslint',
        '--max-warnings',
        '0',
        '--no-eslintrc',
        '--no-ignore',
        '--config',
        'scripts/quality/eslint.config.cjs',
        ...rootJavascript,
      ],
      env,
    );
  }

  const swift = filesFor(entries, 'swift');
  if (swift.length) {
    invoke(binaryPaths.swiftformat, ['--lint', ...swift], env);
  }
  const objectiveC = filesFor(entries, 'objective-c');
  if (objectiveC.length) {
    invoke(clang, ['--dry-run', '--Werror', ...objectiveC], env);
  }
  const shell = filesFor(entries, 'shell');
  if (shell.length) invoke(binaryPaths.shellcheck, shell, env);
  const ruby = filesFor(entries, 'ruby');
  if (ruby.length) {
    invoke(
      'bundle',
      ['exec', 'rubocop', '--config', 'scripts/quality/.rubocop.yml', '--only', 'Lint', ...ruby],
      env,
    );
  }
  const workflows = filesFor(entries, 'yaml').filter((path) =>
    path.startsWith('.github/workflows/'),
  );
  if (workflows.length) {
    for (const args of actionlintInvocationArgs(workflows))
      invoke(binaryPaths.actionlint, args, env);
  }
}
