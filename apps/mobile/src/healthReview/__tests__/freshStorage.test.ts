import { runHealthReviewGraph } from '@orot/agent-runtime';
import { createHealthReviewPort } from '../../agent/healthReview/port';
import { syntheticHealthReview } from '../../agent/healthReview/syntheticFixture';
import { createHealthReviewInvocation } from '../evidenceInvocation';
import { healthReviewSqlite } from '../testing/sqlite';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

it('reopens a real SQLite file and discovers exact pending without automatically running any workflow', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'health-review-storage-'));
  let connection: Awaited<ReturnType<typeof healthReviewSqlite>> | undefined;
  try {
    connection = await healthReviewSqlite(join(directory, 'records.sqlite'));
    const source = await connection.requests.create('다시 열 검토');
    const synthetic = syntheticHealthReview(
      connection.repository,
      source.id,
      false,
    );
    const port = createHealthReviewPort({
      sourceId: source.id,
      repository: connection.repository,
      model: synthetic.model,
      evidence: createHealthReviewInvocation(connection.data).evidence,
    });
    const pending = await runHealthReviewGraph({
      sourceId: source.id,
      threadId: source.id,
      safetyInput: {},
      port,
      checkpointer: connection.saver(source.id),
    });
    if (pending.status !== 'needs_clarification')
      throw new Error('Missing pending snapshot');
    connection.close();
    connection = undefined;
    connection = await healthReviewSqlite(join(directory, 'records.sqlite'));
    expect(await connection.requests.pending(source.id)).toEqual(
      pending.pending,
    );
    expect((await connection.requests.list())[0].pending).toEqual(
      pending.pending,
    );
    expect(synthetic.modelCalls()).toBe(0);
    expect(synthetic.toolCalls()).toBe(0);
  } finally {
    connection?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
