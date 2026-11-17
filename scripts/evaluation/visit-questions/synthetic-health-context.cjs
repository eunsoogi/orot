'use strict';

const { createRecordRepository, runMigrations } = require('@orot/storage');
const {
  openSqliteTestDatabase,
} = require('../../../packages/storage/__tests__/sqliteTestDatabase');
const {
  createHealthContextReader,
} = require('../../../apps/mobile/src/healthEvidence/healthContext/reader');
const {
  readAvailableHealthContextWindow,
} = require('../../../apps/mobile/src/healthEvidence/healthContext/availableWindow');

/** Exercise production period projection against synthetic SQLite records, not an invented aggregate mock. */
async function createSyntheticHealthContext(repository, now) {
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    const stored = createRecordRepository(opened.database);
    for (const kind of [
      'health_observation',
      'symptom_entry',
      'medication_assertion',
      'medication_definition',
      'dose_event',
    ]) {
      for (const record of repository.values.get(kind) ?? []) await stored.put(kind, record);
    }
    return {
      readHealthContext: createHealthContextReader(opened.database),
      resolveHealthContextWindow: (signal) =>
        readAvailableHealthContextWindow(opened.database, signal, now, 'UTC'),
      close: opened.close,
    };
  } catch (error) {
    opened.close();
    throw error;
  }
}
module.exports = { createSyntheticHealthContext };
