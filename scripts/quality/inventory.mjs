import { readFileSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const policy = JSON.parse(readFileSync(new URL('./surface-policy.json', import.meta.url), 'utf8'));

function trackedAndNewPaths() {
  // Include normal untracked files so a new source file is checked before it is staged.
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8').trim());
  return [...new Set(result.stdout.toString('utf8').split('\0').filter(Boolean))].sort();
}

function commentsOnly(path) {
  const content = readFileSync(resolve(repositoryRoot, path), 'utf8');
  let offset = 0;
  while (offset < content.length) {
    if (/\s/.test(content[offset])) {
      offset += 1;
      continue;
    }
    if (content.startsWith('#', offset) || content.startsWith('//', offset)) {
      const lineEnd = content.indexOf('\n', offset);
      offset = lineEnd === -1 ? content.length : lineEnd + 1;
      continue;
    }
    if (content.startsWith('/*', offset)) {
      const commentEnd = content.indexOf('*/', offset + 2);
      // An unterminated block comment is malformed input, not a safe exclusion.
      if (commentEnd === -1) return false;
      offset = commentEnd + 2;
      continue;
    }
    // Any remaining token is an active rule or malformed syntax and needs real tools.
    return false;
  }
  return true;
}

function classify(path) {
  const excluded = policy.excludedPaths[path];
  if (excluded) {
    // This comment-only file becomes active code if a rule is added, so guard its exception.
    if (excluded.guard === 'comments-only' && !commentsOnly(path)) {
      throw new Error(
        `${path} now has active rules; add a real linter and formatter before keeping it`,
      );
    }
    return { path, kind: 'excluded', ...excluded };
  }

  const basename = path.split('/').at(-1);
  const extension = basename.includes('.') ? `.${basename.split('.').pop()}` : '';
  for (const [surface, paths] of Object.entries(policy.specialFiles)) {
    if (paths.includes(path)) return { path, kind: 'surface', surface };
  }
  for (const [suffix, metadata] of Object.entries(policy.projectMetadataSuffixes)) {
    if (path.endsWith(suffix)) return { path, kind: 'metadata', suffix, ...metadata };
  }
  if (policy.nonCodeBasenames[basename]) {
    return { path, kind: 'non-code', reason: policy.nonCodeBasenames[basename] };
  }
  // CI writes logs between inventory and later checks; classify only .log files in that output folder.
  for (const rule of policy.nonCodePathRules) {
    if (path.startsWith(rule.prefix) && rule.extensions.includes(extension)) {
      return { path, kind: 'non-code', reason: rule.reason };
    }
  }
  if (policy.nonCodeExtensions[extension]) {
    return { path, kind: 'non-code', reason: policy.nonCodeExtensions[extension] };
  }
  const surface = Object.entries(policy.surfaces).find(([, entry]) =>
    entry.extensions.includes(extension),
  );
  if (!surface) throw new Error(`Unclassified repository file: ${path}`);
  return { path, kind: 'surface', surface: surface[0] };
}

function validateLintScopes(entries) {
  for (const entry of entries) {
    if (entry.kind !== 'surface' || entry.surface !== 'typescript') continue;
    // Existing TypeScript lint configurations are intentionally rooted at these two workspaces.
    if (!entry.path.startsWith('apps/mobile/') && !entry.path.startsWith('packages/')) {
      throw new Error(`No TypeScript lint scope is configured for ${entry.path}`);
    }
  }
}

export async function buildInventory() {
  const entries = trackedAndNewPaths().map(classify);
  validateLintScopes(entries);
  for (const entry of entries) {
    if (entry.kind !== 'surface') continue;
    const info = await lstat(resolve(repositoryRoot, entry.path));
    // Refuse symlinks: formatters must not follow a repository path outside this checkout.
    if (info.isSymbolicLink())
      throw new Error(`Quality-managed source cannot be a symlink: ${entry.path}`);
    if (!info.isFile())
      throw new Error(`Quality-managed path is not a regular file: ${entry.path}`);
  }
  return entries;
}

export function getRepositoryRoot() {
  return repositoryRoot;
}

export function getPolicy() {
  return policy;
}

export function formatInventory(entries) {
  const included = entries.filter((entry) => entry.kind === 'surface');
  const excluded = entries.filter((entry) => entry.kind !== 'surface');
  const bySurface = new Map();
  for (const entry of included)
    bySurface.set(entry.surface, (bySurface.get(entry.surface) || 0) + 1);
  const lines = [`Maintained files: ${included.length}`];
  for (const [surface, count] of [...bySurface].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`\n${surface} (${count})`);
    for (const entry of included.filter((item) => item.surface === surface))
      lines.push(`  ${entry.path}`);
  }
  lines.push(`\nExplicitly classified non-source files: ${excluded.length}`);
  for (const entry of excluded) {
    const proof = entry.validation ? `; validated by ${entry.validation}` : '';
    const detail =
      entry.reason || entry.reason === '' ? entry.reason : `Xcode metadata ${entry.suffix}`;
    lines.push(`  ${entry.path}: ${detail}${proof}`);
  }
  return lines.join('\n');
}
