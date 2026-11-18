/** Test-only native facade: each Worker owns one file-SQLite connection and
 * processes commands FIFO. No sleeps, WAL switches, or busy-timeout overrides. */
export const opSqliteWorkerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(workerData.path, { readOnly: workerData.readOnly });
const now = () => Number(process.hrtime.bigint()) / 1e6;
parentPort.on('message', command => {
  if (command.close) {
    db.close(); parentPort.postMessage({ id: command.id, closed: true });
    parentPort.close(); return;
  }
  const { id, query, bindings = [], ack } = command;
  const kind = query.includes('WITH days(date, from_key, to_key)') ? 'aggregate' :
    /^(BEGIN|COMMIT|ROLLBACK)/.test(query) ? 'transaction' : 'statement';
  parentPort.postMessage({ trace: { id, kind, phase: 'start', at: now() } });
  let result, error;
  try {
    const statement = db.prepare(query);
    if (statement.columns().length) result = { rows: statement.all(...bindings) };
    else result = { rows: [], rowsAffected: Number(statement.run(...bindings).changes) };
  } catch (failure) { error = failure.message; }
  parentPort.postMessage({ trace: { id, kind, phase: 'end', at: now(), failed: !!error } });
  if (ack) {
    if (error) new Uint8Array(ack, 4).set(new TextEncoder().encode(error).subarray(0, 2047));
    Atomics.store(new Int32Array(ack, 0, 1), 0, error ? 2 : 1);
    Atomics.notify(new Int32Array(ack, 0, 1), 0);
  } else parentPort.postMessage({ id, result, error });
});
`;
