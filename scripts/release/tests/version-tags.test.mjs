import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectPaginatedItems,
  compareVersions,
  isReleaseVersion,
  selectPreviousVersionTag,
} from '../version-tags.mjs';

const sha = (letter) => letter.repeat(40);

test('accepts only stable, exact MAJOR.MINOR.PATCH input without a v prefix', () => {
  assert.equal(isReleaseVersion('0.1.0'), true);
  for (const value of ['v0.1.0', '0.1', '01.1.0', '0.1.0-rc.1', '0.1.0+build'])
    assert.equal(isReleaseVersion(value), false);
});

test('compares numeric version components instead of lexical strings', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
});

test('collects every page, including when the first page is full', () => {
  const pages = collectPaginatedItems((page) => (page === 1 ? ['a', 'b'] : ['c']), {
    pageSize: 2,
    maxPages: 3,
  });
  assert.deepEqual(pages, ['a', 'b', 'c']);
});

test('selects the greatest older reachable stable version and skips non-version or unreachable tags', () => {
  const targets = new Map([
    ['0.1.9', sha('b')],
    ['v0.1.5', sha('c')],
    ['0.1.4', sha('d')],
  ]);
  const reachable = new Set([sha('c'), sha('d')]);
  // Resolve the repository's exact ref name; the version parser handles an optional historical prefix.
  const previous = selectPreviousVersionTag({
    version: '0.2.0',
    tags: ['release-candidate', '0.10.0', '0.1.9', 'v0.1.5', '0.1.4'],
    resolveTag: (tag) => targets.get(tag),
    isAncestor: (target) => reachable.has(target),
  });
  assert.deepEqual(previous, { tag: 'v0.1.5', sha: sha('c'), version: '0.1.5' });
});

test('prefers the exact unprefixed tag when duplicate spellings point to the same commit', () => {
  const previous = selectPreviousVersionTag({
    version: '0.2.0',
    tags: ['v0.1.0', '0.1.0'],
    resolveTag: () => sha('e'),
    isAncestor: () => true,
  });
  assert.deepEqual(previous, { tag: '0.1.0', sha: sha('e'), version: '0.1.0' });
});

test('rejects ambiguous reachable tags for one semantic version and returns null for first release', () => {
  assert.throws(
    () =>
      selectPreviousVersionTag({
        version: '0.2.0',
        tags: ['v0.1.0', '0.1.0'],
        resolveTag: (tag) => (tag.startsWith('v') ? sha('a') : sha('b')),
        isAncestor: () => true,
      }),
    /multiple reachable tags/,
  );
  assert.equal(
    selectPreviousVersionTag({
      version: '0.1.0',
      tags: ['legacy'],
      resolveTag: () => null,
      isAncestor: () => false,
    }),
    null,
  );
});
