import { isPublishedReleaseForTag } from './policy.mjs';

function assertCurrentMain(context, readMainSha, point) {
  if (readMainSha()?.toLowerCase() !== context.sourceSha.toLowerCase())
    throw new Error(`main changed ${point}; publication stopped for the captured candidate`);
}

function matchesCreatedRelease(release, request) {
  // The tag target is read back separately because GitHub ignores target_commitish for an existing tag.
  return Boolean(
    release &&
    release.tag_name === request.tag_name &&
    release.name === request.name &&
    release.body === request.body &&
    release.draft === false &&
    release.prerelease === false,
  );
}

export function publishCandidate({
  context,
  request,
  readMainSha,
  readTagTarget,
  readRelease,
  createTag,
  createRelease,
}) {
  // Tag and release creation are separate writes; recover from a conflict only after exact readback.
  if (context.mode !== 'publish')
    throw new Error('only publish mode may write a tag or GitHub Release');
  if (request.tag_name !== context.version || request.target_commitish !== context.sourceSha)
    throw new Error('release request does not match the verified version and source commit');

  assertCurrentMain(context, readMainSha, 'before the tag check');
  let tagTarget = readTagTarget(context.tag);
  let release = readRelease(context.tag);
  if (tagTarget && tagTarget.toLowerCase() !== context.sourceSha.toLowerCase())
    throw new Error('refusing to move an existing release tag');
  if (release) {
    if (!tagTarget || !isPublishedReleaseForTag(release, context.tag))
      throw new Error('existing GitHub Release is not published on the expected immutable tag');
    return { status: 'already-published', release };
  }

  if (!tagTarget) {
    try {
      createTag(context.tag, context.sourceSha);
    } catch {
      tagTarget = readTagTarget(context.tag);
      if (tagTarget && tagTarget.toLowerCase() !== context.sourceSha.toLowerCase())
        throw new Error('release tag creation raced with another target; no release was created');
      if (!tagTarget)
        throw new Error(
          'release tag creation failed and no matching tag was found; no release was created',
        );
    }
  }
  tagTarget = readTagTarget(context.tag);
  if (tagTarget?.toLowerCase() !== context.sourceSha.toLowerCase())
    throw new Error('release tag readback does not match the verified source commit');

  // A tag is immutable; if main moves after it is created, leave it intact and do not publish a stale release.
  assertCurrentMain(context, readMainSha, 'after the tag check');
  release = readRelease(context.tag);
  if (release) {
    if (!isPublishedReleaseForTag(release, context.tag))
      throw new Error('existing GitHub Release is not published on the expected immutable tag');
    return { status: 'already-published', release };
  }

  let created;
  try {
    created = createRelease(request);
  } catch {
    const racedRelease = readRelease(context.tag);
    if (matchesCreatedRelease(racedRelease, request))
      return { status: 'already-published', release: racedRelease };
    throw new Error('GitHub Release creation failed and no matching concurrent release was found');
  }

  const readback = readRelease(context.tag);
  if (!readback || readback.id !== created?.id || !matchesCreatedRelease(readback, request))
    throw new Error('GitHub Release readback does not match the verified candidate');
  return { status: 'published', release: readback };
}
