export function buildReleaseRequest({ version, sourceSha, notes }) {
  return {
    tag_name: `v${version}`,
    target_commitish: sourceSha,
    name: `Orot v${version}`,
    body: notes,
    draft: false,
    prerelease: false,
  };
}
