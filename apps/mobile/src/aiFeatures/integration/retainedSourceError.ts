export type RetainedSourceInvalidReason = 'changed' | 'deleted' | 'stale';

/** A saved answer cannot safely regain provenance after an input is removed or changed. */
export class RetainedSourceInvalidError extends Error {
  constructor(
    message: string,
    readonly reason: RetainedSourceInvalidReason = 'changed',
  ) {
    super(message);
    this.name = 'RetainedSourceInvalidError';
  }
}
