import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

// These path and text helpers stay separate from the CLI entry point so imports never run the checker.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function quotePath(path) {
  return JSON.stringify(path).replace(/\uFEFF/g, '\\uFEFF');
}

export function decodePath(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error('Git reported a path that is not valid UTF-8; refusing to guess its identity');
  }
}

export function exclusionFor(path, policy) {
  // Specific path, directory, filename, then extension precedence keeps exceptions narrow.
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
  if (
    Object.hasOwn(policy.excludedFilenames, filenameKey) &&
    policy.excludedFilenames[filenameKey]
  ) {
    return policy.excludedFilenames[filenameKey];
  }
  const extension = extname(filename).toLowerCase();
  return Object.hasOwn(policy.excludedExtensions, extension)
    ? policy.excludedExtensions[extension]
    : undefined;
}

export function isIncluded(path, mode, policy) {
  const filename = path.split('/').at(-1);
  return (
    mode === '100755' ||
    policy.includedFilenames.includes(filename) ||
    policy.includedExtensions.includes(extname(filename).toLowerCase())
  );
}

export function countPhysicalLines(bytes, path) {
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

export function fileBytes(root, path) {
  const absolute = resolve(root, ...path.split('/'));
  const rel = relative(root, absolute);
  // Git path records must never let the checker read outside its repository root.
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error(`path escapes repository root: ${quotePath(path)}`);
  return readFileSync(absolute);
}
