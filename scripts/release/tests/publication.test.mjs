import assert from 'node:assert/strict';
import test from 'node:test';
import { publishCandidate } from '../publication.mjs';
import { buildReleaseRequest } from '../release-request.mjs';
import { sourceSha, validContext } from './fixtures.mjs';

const otherSha = 'b'.repeat(40);
const request = buildReleaseRequest({ version: '0.1.0', sourceSha, notes: 'generated notes' });

function setup({ mainSha = sourceSha, tagSha = null, release = null } = {}) {
  const state = { mainSha, tagSha, release };
  const calls = { createTag: 0, createRelease: 0 };
  return {
    state,
    calls,
    adapters: {
      readMainSha: () => state.mainSha,
      readTagTarget: () => state.tagSha,
      readRelease: () => state.release,
      createTag: (_tag, sha) => {
        calls.createTag += 1;
        if (state.tagSha) throw new Error('tag already exists');
        state.tagSha = sha;
      },
      createRelease: (body) => {
        calls.createRelease += 1;
        if (state.release) throw new Error('release already exists');
        state.release = {
          id: 1,
          html_url: 'https://github.com/eunsoogi/orot/releases/tag/0.1.0',
          ...body,
          target_commitish: 'main',
        };
        return state.release;
      },
    },
  };
}

function run(context, adapters) {
  return publishCandidate({ context, request, ...adapters });
}

test('creates the exact tag and release only after rechecking main and publication state', () => {
  const fake = setup();
  const result = run(validContext(), fake.adapters);
  assert.equal(result.status, 'published');
  assert.equal(fake.state.tagSha, sourceSha);
  assert.equal(fake.state.release.tag_name, '0.1.0');
  assert.equal(fake.state.release.target_commitish, 'main');
  assert.equal(fake.calls.createTag, 1);
  assert.equal(fake.calls.createRelease, 1);
});

test('repeat dispatch on an existing matching immutable tag is a no-op', () => {
  const existing = {
    tag_name: '0.1.0',
    html_url: 'https://github.com/eunsoogi/orot/releases/tag/0.1.0',
    target_commitish: 'main',
    draft: false,
    prerelease: false,
  };
  const fake = setup({ tagSha: sourceSha, release: existing });
  const result = run(validContext({ tagTargetSha: sourceSha, release: existing }), fake.adapters);
  assert.equal(result.status, 'already-published');
  assert.equal(fake.calls.createTag, 0);
  assert.equal(fake.calls.createRelease, 0);
});

test('refuses to count an exact-tag draft or prerelease as already published', () => {
  for (const release of [
    { tag_name: '0.1.0', draft: true, prerelease: false },
    { tag_name: '0.1.0', draft: false, prerelease: true },
  ]) {
    const fake = setup({ tagSha: sourceSha, release });
    assert.throws(() => run(validContext(), fake.adapters), /not published/);
    assert.equal(fake.calls.createTag, 0);
    assert.equal(fake.calls.createRelease, 0);
  }
});

test('never moves a conflicting tag or writes against a stale main candidate', () => {
  const moved = setup({ tagSha: otherSha });
  assert.throws(() => run(validContext(), moved.adapters), /refusing to move/);
  assert.equal(moved.calls.createRelease, 0);

  const stale = setup({ mainSha: otherSha });
  assert.throws(() => run(validContext(), stale.adapters), /main changed before the tag check/);
  assert.equal(stale.calls.createTag, 0);
});

test('stops before release creation if main advances after an immutable tag is written', () => {
  const fake = setup();
  fake.adapters.createTag = (_tag, sha) => {
    fake.calls.createTag += 1;
    fake.state.tagSha = sha;
    fake.state.mainSha = otherSha;
  };
  assert.throws(() => run(validContext(), fake.adapters), /after the tag check/);
  assert.equal(fake.state.tagSha, sourceSha);
  assert.equal(fake.calls.createRelease, 0);
});

test('recovers only when a concurrent tag creator chose the same source SHA', () => {
  const sameTarget = setup();
  sameTarget.adapters.createTag = (_tag, sha) => {
    sameTarget.calls.createTag += 1;
    sameTarget.state.tagSha = sha;
    throw new Error('another dispatch created the tag');
  };
  assert.equal(run(validContext(), sameTarget.adapters).status, 'published');

  const otherTarget = setup();
  otherTarget.adapters.createTag = () => {
    otherTarget.calls.createTag += 1;
    otherTarget.state.tagSha = otherSha;
    throw new Error('another dispatch used another target');
  };
  assert.throws(() => run(validContext(), otherTarget.adapters), /raced with another target/);
  assert.equal(otherTarget.calls.createRelease, 0);
});

test('accepts a concurrent matching release but never overwrites a conflicting one', () => {
  const winner = setup();
  winner.adapters.createRelease = (body) => {
    winner.calls.createRelease += 1;
    winner.state.release = {
      id: 2,
      html_url: 'https://github.com/eunsoogi/orot/releases/tag/0.1.0',
      ...body,
      target_commitish: 'main',
    };
    throw new Error('another dispatch created the release');
  };
  assert.equal(run(validContext(), winner.adapters).status, 'already-published');

  const conflict = setup();
  conflict.adapters.createRelease = () => {
    conflict.calls.createRelease += 1;
    conflict.state.release = { tag_name: '0.1.0', body: 'different content' };
    throw new Error('release name already exists');
  };
  assert.throws(() => run(validContext(), conflict.adapters), /no matching concurrent release/);
});

test('dry-run mode cannot call the publication adapters', () => {
  const fake = setup();
  assert.throws(() => run(validContext({ mode: 'dry-run' }), fake.adapters), /only publish mode/);
  assert.equal(fake.calls.createTag, 0);
  assert.equal(fake.calls.createRelease, 0);
});
