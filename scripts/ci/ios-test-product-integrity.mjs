import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function productDigest(directory) {
  const root = await realpath(directory);
  const hash = createHash('sha256');
  async function visit(path) {
    const metadata = await lstat(path);
    const name = relative(root, path);
    if (metadata.isSymbolicLink()) {
      const target = await realpath(path);
      if (!target.startsWith(root + sep))
        throw new Error('Product symlink leaves its verified root');
      hash.update(JSON.stringify(['link', name, await readlink(path)]));
    } else if (metadata.isDirectory()) {
      hash.update(JSON.stringify(['directory', name, metadata.mode & 0o777]));
      for (const item of (await readdir(path)).sort()) await visit(join(path, item));
    } else if (metadata.isFile()) {
      hash.update(JSON.stringify(['file', name, metadata.mode & 0o777, await fileDigest(path)]));
    } else {
      throw new Error('Unsupported native product entry');
    }
  }
  await visit(resolve(root));
  return hash.digest('hex');
}

export function checkArchiveNames(names) {
  for (const name of names.split('\n').filter(Boolean)) {
    if (
      (name !== 'products/' && !name.startsWith('products/')) ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..') ||
      /[\r\0]/.test(name)
    ) {
      throw new Error('Unsafe native product archive path');
    }
  }
}
