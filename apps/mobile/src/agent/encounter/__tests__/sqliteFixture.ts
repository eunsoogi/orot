const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };
import {
  createLangGraphCheckpointStorage,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import {
  runEncounterProcessingGraph,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import type { EncounterApproval, EncounterPending } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createEncounterGraphPort } from '../workflow';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
} from '../syntheticFixture';

jest.mock('../../polyfills', () => ({}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
jest.mock('../../localCheckpointSaver', () => ({
  openLocalWorkflowCheckpointSaver: jest.fn(),
}));

export const sourceId = 'synthetic-encounter-source';
export const threadId = 'synthetic-encounter-thread';
export const time = '2035-01-02T00:00:00Z';

export function approvalFor(pending: EncounterPending): EncounterApproval {
  return {
    pending,
    decision: 'approve',
    candidates: pending.candidates,
    reviewerId: 'synthetic-user',
    reviewedAt: time,
  };
}

export function sqliteEncounterFixture() {
  let directory: string;
  let file: string;
  let handle: ReturnType<typeof openSqliteTestDatabase>;
  const repository = () => createRecordRepository(handle.database);
  const run = (allowModel: boolean, approval?: EncounterApproval) => {
    const synthetic = syntheticEncounterModel(sourceId, allowModel);
    return {
      synthetic,
      result: runEncounterProcessingGraph({
        threadId,
        sourceId,
        approval,
        checkpointer: new SqliteCheckpointSaver(
          createLangGraphCheckpointStorage(handle.database),
        ),
        port: createEncounterGraphPort(repository(), synthetic.model),
      }),
    };
  };
  const pending = async () => {
    const first = run(true);
    const result = await first.result;
    expect(first.synthetic.calls()).toBe(1);
    if (result.status !== 'pending')
      throw new Error('Expected pending graph, received ' + result.status);
    return result.pending;
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'orot-encounter-'));
    file = join(directory, 'records.sqlite');
    handle = openSqliteTestDatabase(file);
    await runMigrations(handle.database);
    await seedSyntheticEncounter(repository(), sourceId);
  });
  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const reopen = () => {
    handle.close();
    handle = openSqliteTestDatabase(file);
  };
  return { repository, run, pending, reopen };
}
