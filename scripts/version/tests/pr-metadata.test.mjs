import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVersionPrReadback,
  classifyExistingVersionPr,
  isPrMetadataCurrent,
  requiredVersionPrMetadata,
  versionPrDetails,
} from '../metadata.mjs';

function matchingPr(version) {
  const details = versionPrDetails(version);
  return {
    html_url: 'https://github.com/eunsoogi/orot/pull/200',
    title: details.title,
    base: { ref: 'main' },
    head: { ref: details.branch, repo: { full_name: 'eunsoogi/orot' } },
    state: 'open',
    draft: true,
    body: details.body,
  };
}

for (const version of ['0.3.0', '12.34.56']) {
  test(`creates, reuses, and verifies metadata for requested version ${version}`, () => {
    const details = versionPrDetails(version);
    const pullRequest = matchingPr(version);
    assert.equal(details.title, `chore: update version to ${version}`);
    assert.equal(details.branch, `automation/version-${version}`);
    assert.equal(details.marker, `<!-- orot-version-update:${version} -->`);
    assert.match(
      details.body,
      new RegExp(`Updates Orot version metadata to ${version.replaceAll('.', '\\.')}\\.`),
    );
    assert.ok(details.body.includes(details.marker));
    assert.doesNotMatch(details.body, /(?:Fixes|Closes|Resolves) #\d+/i);
    assert.equal(
      classifyExistingVersionPr({
        pullRequests: [],
        branchExists: false,
        repository: 'eunsoogi/orot',
        version,
      }).action,
      'create',
    );
    assert.equal(
      classifyExistingVersionPr({
        pullRequests: [pullRequest],
        branchExists: true,
        repository: 'eunsoogi/orot',
        version,
      }).action,
      'reuse',
    );
    const annotated = {
      ...pullRequest,
      body: `${details.body}\n\nMaintainer notes.`.replaceAll('\n', '\r\n'),
    };
    assert.equal(
      classifyExistingVersionPr({
        pullRequests: [annotated],
        branchExists: true,
        repository: 'eunsoogi/orot',
        version,
      }).action,
      'reuse',
    );
    assert.doesNotThrow(() =>
      assertVersionPrReadback(pullRequest, details, 'eunsoogi/orot', pullRequest.html_url),
    );

    for (const changed of [
      { title: 'chore: unrelated' },
      { base: { ref: 'other' } },
      { head: { ref: details.branch, repo: { full_name: 'other/orot' } } },
      { head: { ref: 'automation/version-9.9.9', repo: { full_name: 'eunsoogi/orot' } } },
      { state: 'closed' },
      { draft: false },
      { body: details.marker },
      { body: details.body.replace(details.marker, `${details.marker} extra`) },
      { body: null },
      { body: details.body.replace(version, '9.9.9') },
      { body: details.body.replace(details.marker, '<!-- orot-version-update:9.9.9 -->') },
    ]) {
      const invalid = { ...pullRequest, ...changed };
      assert.throws(
        () =>
          classifyExistingVersionPr({
            pullRequests: [invalid],
            branchExists: true,
            repository: 'eunsoogi/orot',
            version,
          }),
        /does not match/,
      );
      assert.throws(
        () => assertVersionPrReadback(invalid, details, 'eunsoogi/orot', pullRequest.html_url),
        /did not match/,
      );
    }
    assert.throws(
      () =>
        assertVersionPrReadback(
          { ...pullRequest, html_url: `${pullRequest.html_url}0` },
          details,
          'eunsoogi/orot',
          pullRequest.html_url,
        ),
      /did not match/,
    );
    assert.throws(
      () =>
        classifyExistingVersionPr({
          pullRequests: [pullRequest, pullRequest],
          branchExists: true,
          repository: 'eunsoogi/orot',
          version,
        }),
      /multiple open/,
    );
  });
}

test('applies repository policy while preserving additional metadata and ignoring milestones', () => {
  for (const milestone of [null, { number: 42, title: 'Future release' }]) {
    const before = {
      labels: [{ name: 'existing-label' }],
      assignees: [{ login: 'existing-owner' }],
      milestone,
    };
    const expected = requiredVersionPrMetadata(before);
    assert.deepEqual(expected.labels, [
      'existing-label',
      'area/foundation',
      'type/ci',
      'priority/p1',
    ]);
    assert.deepEqual(expected.assignees, ['existing-owner', 'eunsoogi']);
    assert.equal(Object.hasOwn(expected, 'milestone'), false);
    assert.equal(isPrMetadataCurrent(before, expected), false);
    const updated = {
      labels: expected.labels.map((name) => ({ name })),
      assignees: expected.assignees.map((login) => ({ login })),
      milestone,
    };
    assert.equal(isPrMetadataCurrent(updated, expected), true);
    assert.deepEqual(requiredVersionPrMetadata(updated), expected);
    assert.equal(isPrMetadataCurrent({ ...updated, milestone: null }, expected), true);
  }
});
