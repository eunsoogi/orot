export type SelectedLocalReportWitness = Readonly<{
  modelId: string;
  lease: Readonly<{ id: string; version: number }>;
  current: () => boolean;
}>;
export type PrepareLocalReportModel = (
  lease: SelectedLocalReportWitness['lease'],
  signal: AbortSignal,
) => Promise<SelectedLocalReportWitness | undefined>;
