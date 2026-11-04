/** Report unsearchable legacy rows without matching or disclosing their stored content. */
export function summaryArtifactCoverage(
  omitted: number,
  unknownLineage: number,
) {
  return [
    ...(unknownLineage
      ? [
          'Some older saved summaries could not be searched because their original input lineage is unknown. Their content and sources are unavailable for this search.',
        ]
      : []),
    ...(omitted ? ['Some saved AI results could not be included.'] : []),
  ];
}
