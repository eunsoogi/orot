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

export async function runFormat({ entries, mode, env, clang, root, binaryPaths, policy }) {
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
