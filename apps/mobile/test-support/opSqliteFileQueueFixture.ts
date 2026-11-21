import type { SqlDatabase, SqlResult, SqlValue } from '@orot/storage';

declare const __dirname: string;

const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { setImmediate: nextTurn } = require('node:timers');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

/** Uses the installed shipping JS transaction scheduler, not a copied lock.
 * The proxy models one native FIFO over a real synthetic file database. SQL runs
 * on Node's JS thread here, so timings cannot prove native worker/Hermes costs. */
export function openOpSqliteFileQueue() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'active-tool-queue-'));
  const filename = path.join(directory, 'synthetic.sqlite');
  const handle = new DatabaseSync(filename);
  const events: { event: string; at: number }[] = [];
  const mark = (event: string) => events.push({ event, at: performance.now() });
  let afterSubmit: ((query: string) => void) | undefined;
  let tail = Promise.resolve();
  function executeSync(query: string, bindings: SqlValue[] = []): SqlResult {
    const statement = handle.prepare(query);
    if (statement.columns().length) return { rows: statement.all(...bindings) };
    const result = statement.run(...bindings);
    return { rows: [], rowsAffected: Number(result.changes) };
  }
  const native = {
    executeSync(query: string, bindings?: SqlValue[]) {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(query)) mark(query);
      return executeSync(query, bindings);
    },
    execute(query: string, bindings?: SqlValue[]) {
      const aggregate = query.includes('WITH days(date, from_key, to_key)');
      if (aggregate) mark('aggregate_submitted');
      const result = tail.then(
        () =>
          new Promise<SqlResult>((resolve, reject) => {
            nextTurn(() => {
              try {
                if (aggregate) mark('aggregate_worker_start');
                const value = executeSync(query, bindings);
                if (aggregate) mark('aggregate_worker_end');
                resolve(value);
              } catch (error) {
                reject(error);
              }
            });
          }),
      );
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      afterSubmit?.(query);
      return result;
    },
    flushPendingReactiveQueries: async () => undefined,
    close: () => handle.close(),
  };
  // Compile the installed dependency without changing it or Jest's transforms.
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../node_modules/@op-engineering/op-sqlite/src/functions.ts',
    ),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: { open?: (options: { name: string }) => SqlDatabase } = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === 'react-native')
        return { NativeModules: {}, Platform: { OS: 'ios' } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    global: { __OPSQLiteProxy: { open: () => native } },
    setImmediate: nextTurn,
  });
  const database = exports.open!({ name: 'synthetic.sqlite' });
  return {
    database,
    filename,
    events,
    mark,
    observeSubmit(callback?: (query: string) => void) {
      afterSubmit = callback;
    },
    async close() {
      await tail;
      handle.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
