import type { EncounterReviewService } from './controller';

function service(): EncounterReviewService {
  return (require('./service') as typeof import('./service'))
    .encounterReviewService;
}

/** Defer native graph/provider setup until a selected recording actually opens its review surface. */
export const localEncounterReviewService: EncounterReviewService = {
  async restore(...args) {
    return service().restore(...args);
  },
  async start(...args) {
    return service().start(...args);
  },
  async decide(...args) {
    return service().decide(...args);
  },
};
