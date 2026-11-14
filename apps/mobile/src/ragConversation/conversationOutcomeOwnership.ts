/** A committed result may survive Stop, but never regain ownership from a newer request. */
export function ownsOutcome(
  current: boolean,
  ownsController: boolean,
  request: {
    readonly committed?: boolean;
    readonly summaryCommitted?: boolean;
  },
): boolean {
  return (
    current ||
    (ownsController && Boolean(request.committed || request.summaryCommitted))
  );
}
