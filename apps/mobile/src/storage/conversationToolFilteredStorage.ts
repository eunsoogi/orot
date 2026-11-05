import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { HealthContextScope } from '../healthEvidence/healthContext/scope';
import type { HealthContextReport } from '../healthEvidence/healthContext/types';
import {
  captureFilteredToolPeriod,
  readFilteredToolPeriod,
  type FilteredToolPeriod,
} from './conversationToolFilteredPeriod';

/** The input filter is used only inside a transaction and is never returned as stored metadata. */
export function createFilteredToolPeriodStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async captureFilteredToolPeriod(
      reference: EvidenceReference,
      scope: HealthContextScope,
      report: HealthContextReport,
    ) {
      await ensure();
      let result!: FilteredToolPeriod;
      await database.transaction(async tx => {
        result = await captureFilteredToolPeriod(tx, reference, scope, report);
      });
      return result;
    },
    async readFilteredToolPeriod(source: FilteredToolPeriod) {
      await ensure();
      let result!: Awaited<ReturnType<typeof readFilteredToolPeriod>>;
      await database.transaction(async tx => {
        result = await readFilteredToolPeriod(tx, source, false);
      });
      return result;
    },
  };
}
