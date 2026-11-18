import type { SqlDatabase, SqlResult, SqlValue } from '@orot/storage';
import { opSqliteWorkerSource } from './opSqliteWorkerSource';
declare const __dirname: string;
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { setImmediate: nextTurn } = require('node:timers');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
export interface WorkerTrace {
  id: number;
  kind: 'aggregate' | 'statement' | 'transaction';
  phase: 'start' | 'end';
  at: number;
  failed?: boolean;
}

/** Actual installed op-sqlite enhancement with a Node Worker per connection.
 * Sync transaction ACK blocks the JS caller like native executeSync; this is
 * scheduling/visibility evidence, not SQLCipher or Hermes performance evidence. */
export function openOpSqliteWorker(file: string, readOnly: boolean) {
  const worker = new Worker(opSqliteWorkerSource, {
    eval: true,
    workerData: { path: file, readOnly },
  });
  let nextId = 0;
  let closed = false;
  let onTrace: ((event: WorkerTrace) => void) | undefined;
  const events: WorkerTrace[] = [];
  const pending = new Map<
    number,
    { resolve(value: SqlResult): void; reject(error: Error): void }
  >();
  const exited = new Promise<number>(resolve => worker.once('exit', resolve));
  worker.on('error', (error: Error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  });
  worker.on(
    'message',
    (message: {
      trace?: WorkerTrace;
      id: number;
      error?: string;
      result: SqlResult;
    }) => {
      if (message.trace) {
        events.push(message.trace);
        onTrace?.(message.trace);
        return;
      }
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item?.reject(new Error(message.error));
      else item?.resolve(message.result);
    },
  );
  function request(query: string, bindings?: SqlValue[]) {
    if (closed) return Promise.reject(new Error('Connection is closed.'));
    const id = ++nextId;
    return new Promise<SqlResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, query, bindings });
    });
  }
  const native = {
    execute: request,
    executeSync(query: string) {
      if (!/^(BEGIN TRANSACTION;|COMMIT;|ROLLBACK;)$/.test(query))
        throw new Error(
          'Only transaction controls use synchronous ACK in this fixture.',
        );
      const ack = new SharedArrayBuffer(2052);
      const state = new Int32Array(ack, 0, 1);
      worker.postMessage({ id: ++nextId, query, ack });
      Atomics.wait(state, 0, 0);
      if (Atomics.load(state, 0) === 2)
        throw new Error(
          String.fromCharCode(...new Uint8Array(ack, 4)).replace(/\0.*$/, ''),
        );
      return { rows: [] };
    },
    flushPendingReactiveQueries: async () => undefined,
  };
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../../../../node_modules/@op-engineering/op-sqlite/src/functions.ts',
    ),
    'utf8',
  );
  const exports: {
    open?: (options: { name: string; readOnly: boolean }) => SqlDatabase;
  } = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        if (name === 'react-native')
          return { NativeModules: {}, Platform: { OS: 'ios' } };
        throw new Error(`Unexpected module: ${name}`);
      },
      global: { __OPSQLiteProxy: { open: () => native } },
      setImmediate: nextTurn,
    },
  );
  return {
    database: exports.open!({ name: file, readOnly }),
    events,
    observe(callback?: (event: WorkerTrace) => void) {
      onTrace = callback;
    },
    async close() {
      closed = true;
      const id = ++nextId;
      await new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve: () => resolve(), reject });
        worker.postMessage({ id, close: true });
      });
      return exited;
    },
  };
}
