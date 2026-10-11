import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommitAncestor, listRepositoryTags, readTagTarget } from '../github-api.mjs';

const tagSha = 'b'.repeat(40);
const nestedTagSha = 'c'.repeat(40);
const commitSha = 'd'.repeat(40);

test('resolves annotated and nested annotated tags to the commit target', () => {
  const responses = new Map([
    ['repos/eunsoogi/orot/git/ref/tags/0.1.0', { object: { type: 'tag', sha: tagSha } }],
    [`repos/eunsoogi/orot/git/tags/${tagSha}`, { object: { type: 'tag', sha: nestedTagSha } }],
    [
      `repos/eunsoogi/orot/git/tags/${nestedTagSha}`,
      { object: { type: 'commit', sha: commitSha } },
    ],
  ]);
  assert.equal(
    readTagTarget('eunsoogi/orot', '0.1.0', (endpoint) => responses.get(endpoint)),
    commitSha,
  );
});

test('paginates repository tags from authentic page responses', () => {
  const calls = [];
  const tags = listRepositoryTags('eunsoogi/orot', (endpoint) => {
    calls.push(endpoint);
    return endpoint.endsWith('page=1')
      ? Array.from({ length: 100 }, (_, index) => ({ name: `v0.${index}.0` }))
      : [{ name: '0.1.0' }];
  });
  assert.equal(tags.length, 101);
  assert.match(calls[1], /page=2$/);
});

test('considers only ahead or identical commits reachable from the candidate', () => {
  assert.equal(
    isCommitAncestor('eunsoogi/orot', commitSha, 'e'.repeat(40), () => ({ status: 'ahead' })),
    true,
  );
  assert.equal(
    isCommitAncestor('eunsoogi/orot', commitSha, 'e'.repeat(40), () => ({ status: 'diverged' })),
    false,
  );
});
