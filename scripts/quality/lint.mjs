import { resolve } from 'node:path';
import { createQualityTools, filesFor } from './process.mjs';

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
    invoke(
      'pnpm',
      [
        '--filter',
        '@orot/mobile',
        'exec',
        'eslint',
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
    invoke(binaryPaths.actionlint, workflows, env);
  }
}
