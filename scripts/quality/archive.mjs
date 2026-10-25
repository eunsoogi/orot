import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

// Keep archive members relative and pinned so large upstream bundles can be unpacked safely.
export function pinnedArchiveEntries(spec) {
  if (spec.archiveEntries === undefined) return null;
  if (!Array.isArray(spec.archiveEntries) || !['tar.gz', 'tar.xz'].includes(spec.archive)) {
    throw new Error('Archive entry selection requires a tar archive and a path list');
  }
  if (!spec.archiveEntries.includes(spec.binary)) {
    throw new Error('The pinned archive entry list must include the executable');
  }

  const uniqueEntries = new Set();
  for (const entry of spec.archiveEntries) {
    const segments = typeof entry === 'string' ? entry.split('/') : [];
    if (
      typeof entry !== 'string' ||
      !entry ||
      isAbsolute(entry) ||
      entry.startsWith('-') ||
      entry.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      uniqueEntries.has(entry)
    ) {
      throw new Error(`Unsafe or duplicate pinned archive entry: ${JSON.stringify(entry)}`);
    }
    uniqueEntries.add(entry);
  }
  return [...uniqueEntries];
}

// A cached pinned asset is usable only when its executable and every selected runtime file exist.
export function pinnedAssetEntries(spec) {
  return pinnedArchiveEntries(spec) ?? [spec.binary];
}

export async function hasCompletePinnedAsset(spec, destination) {
  for (const entry of pinnedAssetEntries(spec)) {
    try {
      if (!(await stat(join(destination, entry))).isFile()) return false;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

export function archiveExtractionPlan(spec, archive, temporary) {
  const selectedEntries = pinnedArchiveEntries(spec);
  if (spec.archive === 'zip') {
    return { command: 'unzip', args: ['-q', archive, '-d', temporary] };
  }
  if (spec.archive === 'tar.gz' || spec.archive === 'tar.xz') {
    const args = [spec.archive === 'tar.gz' ? '-xzf' : '-xJf', archive, '-C', temporary];
    if (selectedEntries) args.push('--', ...selectedEntries);
    return { command: 'tar', args };
  }
  if (spec.archive !== undefined) throw new Error(`Unsupported pinned archive: ${spec.archive}`);
  return null;
}
