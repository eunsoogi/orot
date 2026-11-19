import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';

/** Jest leaves Metro's lazy imports intact. Transform the two entry modules
 * while preserving production factory code and using Jest's actual dependencies. */
export function loadProductionLocalData() {
  const load = (filename, overrides = {}) => {
    const transformed = transformSync(readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      presets: ['module:@react-native/babel-preset'],
      plugins: [
        require.resolve('@babel/plugin-transform-dynamic-import', {
          paths: [require.resolve('@babel/preset-env')],
        }),
      ],
    });
    const module = { exports: {} };
    runInNewContext(transformed.code, {
      module,
      exports: module.exports,
      require: name =>
        overrides[name] ??
        require(
          name.startsWith('.')
            ? './' + relative(__dirname, resolve(dirname(filename), name))
            : name,
        ),
    });
    return module.exports;
  };
  return load(require.resolve('../localData'), {
    './conversationLocalAccess': load(
      require.resolve('../conversationLocalAccess'),
    ),
  }).openAiFeatureLocalData;
}
