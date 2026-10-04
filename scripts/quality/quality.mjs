import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildInventory, formatInventory, getPolicy, getRepositoryRoot } from './inventory.mjs';
import { runFormat } from './format.mjs';
import { runLint } from './lint.mjs';
import { createQualityTools, requireFile } from './process.mjs';

const root = getRepositoryRoot();
const cache = join(root, 'node_modules/.cache/orot-quality');
const versions = JSON.parse(
  await readFile(new URL('./tool-versions.json', import.meta.url), 'utf8'),
);
const policy = getPolicy();
const javaHome = join(cache, 'jdk', versions.jdk.version, 'Contents/Home');
const binaryPaths = Object.fromEntries(
  Object.entries(versions.tools).map(([name, spec]) => [
    name,
    join(cache, name, spec.version, spec.binary),
  ]),
);

const { capture } = createQualityTools(root);

function qualityEnvironment() {
  const missing = Object.values(binaryPaths).filter((path) => !path || !requireFile(path));
  if (!requireFile(join(javaHome, 'bin/java')) || missing.length > 0) {
    throw new Error('Pinned tools are missing; run pnpm install and pnpm quality:setup first');
  }
  const pathEntries = [
    join(javaHome, 'bin'),
    ...Object.values(binaryPaths).map((path) => dirname(path)),
  ];
  const env = {
    ...process.env,
    BUNDLE_GEMFILE: join(root, 'scripts/quality/Gemfile'),
    JAVA_HOME: javaHome,
    PATH: [...pathEntries, process.env.PATH || ''].join(':'),
  };
  for (const [name, executable] of Object.entries(binaryPaths)) {
    const output = capture(executable, ['--version'], env);
    if (!output.includes(versions.tools[name].version))
      throw new Error(`${name} version mismatch: ${output}`);
  }
  const java = capture(join(javaHome, 'bin/java'), ['-version'], env);
  if (!java.includes(versions.jdk.version.split('+')[0]))
    throw new Error(`JDK version mismatch: ${java}`);
  const clang = capture('xcrun', ['--find', 'clang-format'], env);
  const clangVersion = capture(clang, ['--version'], env);
  if (!clangVersion.includes(versions.clangFormat.version))
    throw new Error(`clang-format version mismatch: ${clangVersion}`);
  const prettier = capture('pnpm', ['exec', 'prettier', '--version'], env);
  if (prettier !== '3.9.9') throw new Error(`Prettier version mismatch: ${prettier}`);
  const eslint = capture('pnpm', ['exec', 'eslint', '--version'], env);
  if (!eslint.includes('8.57.1')) throw new Error(`ESLint version mismatch: ${eslint}`);
  return { env, clang };
}

function entriesWithout(entries, rawOptions, command) {
  if (rawOptions.length === 0) return entries;
  if (!['lint', 'format:check', 'format:write'].includes(command)) {
    throw new Error('Path exclusions are only available for a focused quality invocation');
  }
  // CI uses the complete inventory; exclusions are only for an explicitly owner-gated local run.
  const excluded = [];
  for (let index = 0; index < rawOptions.length; index += 1) {
    if (rawOptions[index] !== '--exclude' || !rawOptions[index + 1]) {
      throw new Error('Use --exclude <exact-path-or-directory-prefix>');
    }
    const path = rawOptions[index + 1];
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      throw new Error(`Invalid repository-relative exclusion: ${path}`);
    }
    excluded.push(path);
    index += 1;
  }
  const matches = (path) =>
    excluded.some((item) => (item.endsWith('/') ? path.startsWith(item) : path === item));
  const skipped = entries.filter((entry) => entry.kind === 'surface' && matches(entry.path));
  console.log(`Explicitly withheld from this invocation (${skipped.length} files):`);
  for (const entry of skipped) console.log(`  ${entry.path}`);
  return entries.filter((entry) => entry.kind !== 'surface' || !matches(entry.path));
}

async function main() {
  const command = process.argv[2];
  if (!['inventory', 'lint', 'format:check', 'format:write'].includes(command)) {
    throw new Error('Use inventory, lint, format:check, or format:write');
  }
  const entries = entriesWithout(await buildInventory(), process.argv.slice(3), command);
  if (command === 'inventory') {
    console.log(formatInventory(entries));
    return;
  }
  const { env, clang } = qualityEnvironment();
  console.log(
    `Checking ${entries.filter((entry) => entry.kind === 'surface').length} maintained files across ${Object.keys(policy.surfaces).length} configured surfaces.`,
  );
  if (command === 'lint') {
    runLint({ entries, env, clang, binaryPaths, root });
  } else {
    await runFormat({
      entries,
      mode: command,
      env,
      clang,
      root,
      cache,
      binaryPaths,
      policy,
    });
  }
}

main().catch((error) => {
  console.error(`Quality check failed: ${error.message}`);
  process.exitCode = 1;
});
