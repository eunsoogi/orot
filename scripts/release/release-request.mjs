// Preserve the user's version spelling in the new tag and release name.
export function buildReleaseRequest({ version, sourceSha, notes }) {
  return {
    tag_name: version,
    target_commitish: sourceSha,
    name: `Orot ${version}`,
    body: notes,
    draft: false,
    prerelease: false,
  };
}
