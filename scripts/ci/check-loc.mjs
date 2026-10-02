#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'loc-policy.json');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function quotePath(path) {
  return JSON.stringify(path).replace(/\uFEFF/g, '\\uFEFF');
}

function fail(message) {
  console.error(`LOC check failed: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  let base;
  let all = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--all') all = true;
    else if (args[i] === '--help') return { help: true };
    else throw new Error(`unexpected argument: ${args[i]}`);
  }
  if (all === Boolean(base)) throw new Error('provide exactly one of --base <commit> or --all');
  if (base && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base)) throw new Error('base must be a commit SHA or simple Git ref');
  return { base, all };
}

function runGit(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: options.encoding ?? null, stdio: ['ignore', 'pipe', 'pipe'] });
}

function nulFields(bytes) {
  const fields = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      fields.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  if (start !== bytes.length) throw new Error('Git returned a path list without a NUL terminator');
  return fields;
}

function decodePath(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error('Git reported a path that is not valid UTF-8; refusing to guess its identity');
  }
}

function changedFiles(root, base) {
  const raw = runGit(root, ['diff', '--raw', '-z', '--find-renames', '--find-copies', '--find-copies-harder', base, '--']);
  const fields = nulFields(raw);
  const changes = [];
  const deleted = [];
  for (let i = 0; i < fields.length;) {
    const metadata = fields[i++].toString('ascii');
    const match = metadata.match(/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]\d*)$/i);
    if (!match) throw new Error(`cannot parse Git diff record ${JSON.stringify(metadata)}`);
    const [, , mode, status] = match;
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    if (i + pathCount > fields.length) throw new Error('Git returned an incomplete rename or copy record');
    const source = decodePath(fields[i++]);
    const destination = pathCount === 2 ? decodePath(fields[i++]) : source;
    if (status[0] === 'D' || mode === '000000') {
      deleted.push(destination);
      continue;
    }
    if (!['A', 'M', 'R', 'C', 'T'].includes(status[0])) throw new Error(`unsupported Git change status ${status}`);
    changes.push({ path: destination, mode, action: status[0] === 'R' ? `RENAMED from ${quotePath(source)}` : status[0] === 'C' ? `COPIED from ${quotePath(source)}` : 'CHANGED' });
  }

  for (const field of nulFields(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']))) {
    const path = decodePath(field);
    const absolute = resolve(root, ...path.split('/'));
    const stat = lstatSync(absolute);
    const mode = stat.isSymbolicLink() ? '120000' : (stat.mode & 0o111) ? '100755' : '100644';
    changes.push({ path, mode, action: 'UNTRACKED' });
  }
  return { changes, deleted };
}

function allFiles(root) {
  const files = nulFields(runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']));
  return files.map((field) => {
    const path = decodePath(field);
    const absolute = resolve(root, ...path.split('/'));
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const mode = stat.isSymbolicLink() ? '120000' : (stat.mode & 0o111) ? '100755' : '100644';
    return { path, mode, action: 'AUDIT' };
  }).filter(Boolean);
}

function exclusionFor(path, policy) {
  if (Object.hasOwn(policy.excludedPaths, path)) return policy.excludedPaths[path];
  const parts = path.split('/');
  for (const part of parts.slice(0, -1)) {
    const key = part.toLowerCase();
    if (Object.hasOwn(policy.excludedPathSegments, key) && policy.excludedPathSegments[key]) {
      return policy.excludedPathSegments[key];
    }
  }
  const filename = parts.at(-1);
  const filenameKey = filename.toLowerCase();
  if (Object.hasOwn(policy.excludedFilenames, filenameKey) && policy.excludedFilenames[filenameKey]) {
    return policy.excludedFilenames[filenameKey];
  }
  const extension = extname(filename).toLowerCase();
  return Object.hasOwn(policy.excludedExtensions, extension) ? policy.excludedExtensions[extension] : undefined;
}

function isIncluded(path, mode, policy) {
  const filename = path.split('/').at(-1);
  return mode === '100755'
    || policy.includedFilenames.includes(filename)
    || policy.includedExtensions.includes(extname(filename).toLowerCase());
}

function countPhysicalLines(bytes, path) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error(`${quotePath(path)} is not valid UTF-8 text`);
  }
  if (text.includes('\0')) throw new Error(`${quotePath(path)} contains binary NUL bytes`);
  if (text.length === 0) return 0;
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return breaks + (/(?:\r\n|\r|\n)$/.test(text) ? 0 : 1);
}

function fileBytes(root, path) {
  const absolute = resolve(root, ...path.split('/'));
  const rel = relative(root, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`path escapes repository root: ${quotePath(path)}`);
  return readFileSync(absolute);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: node scripts/ci/check-loc.mjs --base <commit> | --all');
      return;
    }
  } catch (error) {
    fail(`${error.message}\nUsage: node scripts/ci/check-loc.mjs --base <commit> | --all`);
    return;
  }

  let root;
  let policy;
  try {
    root = runGit(process.cwd(), ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
    if (!Number.isInteger(policy.limit) || policy.limit < 1) throw new Error('policy limit must be a positive integer');
  } catch (error) {
    fail(`cannot load repository or policy: ${error.message}`);
    return;
  }

  let files;
  let deleted = [];
  try {
    if (options.all) files = allFiles(root);
    else {
      runGit(root, ['rev-parse', '--verify', '--quiet', `${options.base}^{commit}`]);
      const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', options.base, 'HEAD'], { cwd: root, stdio: 'ignore' });
      if (ancestry.status !== 0) throw new Error(`base ${options.base} is missing or is not an ancestor of HEAD`);
      ({ changes: files, deleted } = changedFiles(root, options.base));
    }
  } catch (error) {
    fail(`cannot determine required files: ${error.stderr?.toString().trim() || error.message}`);
    return;
  }

  const problems = [];
  for (const file of files) {
    const shownPath = quotePath(file.path);
    if (!['100644', '100755'].includes(file.mode)) {
      problems.push(`${shownPath} has unexpected Git file mode ${file.mode}; only regular files are supported`);
      continue;
    }
    const excluded = exclusionFor(file.path, policy);
    if (excluded) {
      console.log(`EXCLUDED ${shownPath} reason=${JSON.stringify(excluded)}`);
      continue;
    }
    if (!isIncluded(file.path, file.mode, policy)) {
      problems.push(`${shownPath} has an unclassified file type; add it to the explicit include or exclusion policy`);
      continue;
    }
    try {
      const lines = countPhysicalLines(fileBytes(root, file.path), file.path);
      if (lines > policy.limit) problems.push(`${file.action} ${shownPath} lines=${lines} limit=${policy.limit}`);
      else console.log(`PASS ${file.action} ${shownPath} lines=${lines} limit=${policy.limit}`);
    } catch (error) {
      problems.push(error.message);
    }
  }

  for (const path of deleted) console.log(`DELETED ${quotePath(path)}; no current file to count`);
  if (problems.length) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    fail(`${problems.length} file(s) require attention`);
  } else {
    if (files.length === 0) console.log('No current files to count.');
    console.log(`LOC check passed: ${files.length} current path(s), limit ${policy.limit}.`);
  }
}

main();
