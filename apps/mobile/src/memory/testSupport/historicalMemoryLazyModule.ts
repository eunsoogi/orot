// Metro normally owns these lazy modules. Execute their actual source in the
// Jest RN harness rather than replacing their storage and admission decisions.
export function compileHistoricalMemoryModule(path: string) {
  const { readFileSync } = require('node:fs');
  const { dirname, resolve } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const { transformSync } = require('@babel/core');
  const resolveModule = (
    require as NodeRequire & {
      resolve(name: string, options?: { paths: string[] }): string;
    }
  ).resolve;
  const filename = resolveModule(path);
  const transformed = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [resolveModule('@react-native/babel-preset')],
    plugins: [
      resolveModule('@babel/plugin-transform-dynamic-import', {
        paths: [resolveModule('@babel/preset-env')],
      }),
    ],
  });
  const module = { exports: {} };
  runInNewContext(transformed!.code!, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    require: (name: string) =>
      require(name.startsWith('.') ? resolve(dirname(filename), name) : name),
  });
  return module.exports;
}
