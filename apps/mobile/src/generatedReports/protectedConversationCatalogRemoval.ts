import type { SqlDatabase } from '@orot/storage';
import { prepareConversationCatalogRemoval } from './conversationCatalogExclusions';
import { watchSavedReportNativeProtection } from './savedReportNativeProtection';
import type { GeneratedReportReader } from './types';

export function protectedConversationCatalogRemoval(
  database: SqlDatabase,
  isCurrentDatabase: (owner: SqlDatabase) => boolean,
): NonNullable<GeneratedReportReader['prepareCatalogRemoval']> {
  return async (row, signal, ownerCurrent) => {
    const owner = () =>
      !signal.aborted && ownerCurrent() && isCurrentDatabase(database);
    if (!owner()) return;
    const protection = watchSavedReportNativeProtection(signal, () => {});
    if (!protection) return;
    let keep = false;
    try {
      const run = await prepareConversationCatalogRemoval(database, row, {
        current: () => owner() && protection.current(),
        confirmProtected: protection.confirm,
      });
      if (!run || !owner() || !protection.current()) return;
      keep = true;
      return async () => {
        try {
          return await run();
        } finally {
          protection.dispose();
        }
      };
    } finally {
      if (!keep) protection.dispose();
    }
  };
}
