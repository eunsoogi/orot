import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const vendorPath = 'vendor/onnxruntime-swift-package-manager';
export const pinnedCommit = 'b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2';
export const pinnedTree = '59178cede37305e8725fd09d5907d872a55004f1';
const manifest = JSON.parse(readFileSync(new URL('./onnx-vendor-manifest.json', import.meta.url)));

function objectHash(kind, bytes) {
  return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
}

// Reconstruct Git's binary trees without trusting an archive digest or local Git
// index. This also checks untracked/ignored additions and executable-bit changes.
function treeHash(entries) {
  const children = new Map();
  for (const entry of entries) {
    const slash = entry.path.indexOf('/');
    const name = slash < 0 ? entry.path : entry.path.slice(0, slash);
    if (slash < 0) children.set(name, { ...entry, name });
    else {
      if (!children.has(name)) children.set(name, { name, mode: '40000', entries: [] });
      children.get(name).entries.push({ ...entry, path: entry.path.slice(slash + 1) });
    }
  }
  const sorted = [...children.values()].sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.name + (a.entries ? '/' : '')),
      Buffer.from(b.name + (b.entries ? '/' : '')),
    ),
  );
  return objectHash(
    'tree',
    Buffer.concat(
      sorted.map((entry) =>
        Buffer.concat([
          Buffer.from(`${entry.mode} ${entry.name}\0`),
          Buffer.from(entry.entries ? treeHash(entry.entries) : entry.hash, 'hex'),
        ]),
      ),
    ),
  );
}

export function manifestEntries(value = manifest) {
  if (
    value.commit !== pinnedCommit ||
    value.tree !== pinnedTree ||
    objectHash('commit', Buffer.from(value.commit_object)) !== pinnedCommit ||
    !value.commit_object.startsWith(`tree ${pinnedTree}\n`)
  )
    throw new Error('ONNX pinned commit provenance mismatch');
  const entries = value.ls_tree
    .trimEnd()
    .split('\n')
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(line);
      if (!match || match[3].split('/').some((part) => !part || part === '.' || part === '..'))
        throw new Error('Invalid ONNX manifest entry');
      return { mode: match[1], hash: match[2], path: match[3] };
    });
  if (
    entries.length !== 75 ||
    new Set(entries.map((entry) => entry.path)).size !== entries.length ||
    treeHash(entries) !== pinnedTree
  )
    throw new Error('ONNX pinned tree mismatch');
  return entries;
}

const exactPaths = new Set(manifestEntries().map((entry) => `${vendorPath}/${entry.path}`));
export function isImmutableOnnxPath(path) {
  return exactPaths.has(path);
}

export function verifyOnnxVendor(root, value = manifest) {
  const expected = manifestEntries(value);
  const actual = [];
  const directory = join(root, vendorPath);
  function walk(path = '') {
    const absolute = join(directory, path);
    if (!lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink())
      throw new Error(`ONNX directory is not a real directory: ${path}`);
    for (const name of readdirSync(absolute)) {
      const child = path ? `${path}/${name}` : name;
      const info = lstatSync(join(directory, child));
      if (info.isDirectory()) walk(child);
      else {
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`ONNX invalid file: ${child}`);
        actual.push({
          path: child,
          mode: info.mode & 0o111 ? '100755' : '100644',
          hash: objectHash('blob', readFileSync(join(directory, child))),
        });
      }
    }
  }
  walk();
  const byPath = (a, b) => a.path.localeCompare(b.path);
  if (
    JSON.stringify(actual.sort(byPath)) !==
    JSON.stringify(expected.map(({ path, mode, hash }) => ({ path, mode, hash })).sort(byPath))
  )
    throw new Error('ONNX files, modes or blobs differ from upstream');
  if (treeHash(actual) !== pinnedTree) throw new Error('ONNX checkout tree mismatch');
  return { commit: pinnedCommit, tree: pinnedTree, files: actual.length };
}
