import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVersionPrReadback,
  isPrMetadataCurrent,
  requiredPrMetadataFromIssue,
  versionPrDetails,
} from '../metadata.mjs';

test('copies issue metadata without dropping existing PR metadata', () => {
  const issue = {
    labels: ['area/foundation', 'type/ci', 'priority/p1'].map((name) => ({ name })),
    assignees: [{ login: 'eunsoogi' }],
    milestone: { number: 3, title: '0.1.0' },
  };
  const before = {
    labels: [{ name: 'existing-label' }],
    assignees: [{ login: 'existing-owner' }],
    milestone: null,
  };

  const expected = requiredPrMetadataFromIssue(issue, before);
  assert.deepEqual(expected.labels, [
    'existing-label',
    'area/foundation',
    'type/ci',
    'priority/p1',
  ]);
  assert.deepEqual(expected.assignees, ['existing-owner', 'eunsoogi']);
  assert.equal(expected.milestone, 3);
  assert.equal(isPrMetadataCurrent(before, expected), false);
  assert.throws(
    () =>
      requiredPrMetadataFromIssue({ ...issue, milestone: { number: 4, title: '0.2.0' } }, before),
    /0\.1\.0 milestone/,
  );
});

test('requires the matching English issue link and draft PR readback', () => {
  const details = versionPrDetails('0.1.1');
  const pullRequest = {
    html_url: 'https://github.com/eunsoogi/orot/pull/200',
    title: details.title,
    base: { ref: 'main' },
    head: { ref: details.branch, repo: { full_name: 'eunsoogi/orot' } },
    state: 'open',
    draft: true,
    body: `Updates version.\nFixes #171\n${details.marker}`,
  };
  assert.doesNotThrow(() =>
    assertVersionPrReadback(pullRequest, details, 'eunsoogi/orot', pullRequest.html_url),
  );
  assert.throws(
    () =>
      assertVersionPrReadback(
        { ...pullRequest, draft: false },
        details,
        'eunsoogi/orot',
        pullRequest.html_url,
      ),
    /did not match/,
  );
});

test('rejects a similarly prefixed issue number in the final PR readback', () => {
  const details = versionPrDetails('0.1.1');
  const pullRequest = {
    html_url: 'https://github.com/eunsoogi/orot/pull/200',
    title: details.title,
    base: { ref: 'main' },
    head: { ref: details.branch, repo: { full_name: 'eunsoogi/orot' } },
    state: 'open',
    draft: true,
    body: `Updates version.\nFixes #1710\n${details.marker}`,
  };

  assert.throws(
    () => assertVersionPrReadback(pullRequest, details, 'eunsoogi/orot', pullRequest.html_url),
    /did not match/,
  );
});
