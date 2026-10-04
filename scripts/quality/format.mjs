import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createQualityTools, filesFor } from './process.mjs';

function runPrettier(entries, mode, env, root, policy, invoke) {
  const prettierFiles = entries.filter(
    (entry) => entry.kind === 'surface' && policy.surfaces[entry.surface].format === 'prettier',
  );
  const plugins = ['--plugin', '@prettier/plugin-xml', '--plugin', 'prettier-plugin-properties'];
  const xml = filesFor(entries, 'xml');
  if (xml.length > 0) {
    // Xcode's .entitlements and .xcprivacy suffixes need an explicit parser.
    invoke('pnpm', ['exec', 'prettier', mode, ...plugins, '--parser', 'xml', ...xml], env);
  }
  const paths = prettierFiles
    .map((entry) => entry.path)
    .filter((path) => path !== 'apps/mobile/.watchmanconfig' && !xml.includes(path));
  if (paths.length > 0) {
    invoke('pnpm', ['exec', 'prettier', mode, ...plugins, ...paths], env);
  }
  const watchman = prettierFiles.find((entry) => entry.path === 'apps/mobile/.watchmanconfig');
  if (watchman) {
    invoke('pnpm', ['exec', 'prettier', mode, '--parser', 'json', watchman.path], env);
  }
}

async function checkGroovyFormatting(files, env, root, cache, invoke) {
  const directory = await mkdtemp(join(cache, 'groovy-check-'));
  try {
    for (const file of files) {
      const destination = join(directory, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(root, file), destination);
    }
    // npm-groovy-lint writes in format mode, so compare disposable copies.
    invoke(
      'pnpm',
      [
        'exec',
        'npm-groovy-lint',
        '--failon',
        'error',
        '--format',
        '--loglevel',
        'warning',
        ...files.map((file) => join(directory, file)),
      ],
      env,
    );
    const changed = [];
    for (const file of files) {
      const original = await readFile(resolve(root, file));
      const formatted = await readFile(join(directory, file));
      if (!original.equals(formatted)) changed.push(file);
    }
    if (changed.length) {
      throw new Error(
        'Groovy format check failed; run pnpm format:write for: ' + changed.join(', '),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runFormat({ entries, mode, env, clang, root, cache, binaryPaths, policy }) {
  const { invoke } = createQualityTools(root);
  runPrettier(entries, mode === 'format:write' ? '--write' : '--check', env, root, policy, invoke);
  const swift = filesFor(entries, 'swift');
  if (swift.length) {
    invoke(binaryPaths.swiftformat, mode === 'format:write' ? swift : ['--lint', ...swift], env);
  }
  const objectiveC = filesFor(entries, 'objective-c');
  if (objectiveC.length) {
    invoke(
      clang,
      mode === 'format:write' ? ['-i', ...objectiveC] : ['--dry-run', '--Werror', ...objectiveC],
      env,
    );
  }
  const shell = filesFor(entries, 'shell');
  if (shell.length) {
    invoke(
      binaryPaths.shfmt,
      [mode === 'format:write' ? '-w' : '-d', '-i', '2', '-ci', ...shell],
      env,
    );
  }
  const kotlin = filesFor(entries, 'kotlin');
  if (kotlin.length) {
    invoke(binaryPaths.ktlint, [...(mode === 'format:write' ? ['--format'] : []), ...kotlin], env);
  }
  const groovy = filesFor(entries, 'groovy');
  if (groovy.length) {
    if (mode === 'format:write') {
      invoke(
        'pnpm',
        [
          'exec',
          'npm-groovy-lint',
          '--failon',
          'error',
          '--format',
          '--loglevel',
          'warning',
          ...groovy,
        ],
        env,
      );
    } else {
      await checkGroovyFormatting(groovy, env, root, cache, invoke);
    }
  }
  const ruby = filesFor(entries, 'ruby');
  if (ruby.length) {
    invoke(
      'bundle',
      [
        'exec',
        'rubocop',
        '--config',
        'scripts/quality/.rubocop.yml',
        ...(mode === 'format:write' ? ['--autocorrect'] : []),
        '--only',
        'Layout',
        ...ruby,
      ],
      env,
    );
  }
}
