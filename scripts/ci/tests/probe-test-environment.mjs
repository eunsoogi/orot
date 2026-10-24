import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

// Evaluate the actual probe module with controlled services and clock; no network or model runs here.
export function environment(source, dependencies = {}) {
  let now = 0,
    sequence = 0;
  const timers = new Map();
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    module: { exports },
    AbortController,
    Error,
    console: { log() {} },
    Date: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected probe dependency: ' + name);
      return dependencies[name];
    },
  });
  return {
    exports,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}
