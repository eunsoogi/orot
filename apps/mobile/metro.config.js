const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

function isRememoriFileStorageRequest(context, moduleName) {
  if (moduleName !== 'fs/promises') return false;
  const segments = path.normalize(context.originModulePath).split(path.sep);
  return segments.some(
    (segment, index) =>
      segment === 'node_modules' && segments[index + 1] === 'rememori',
  );
}

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest(context, moduleName, platform) {
      if (isRememoriFileStorageRequest(context, moduleName)) {
        return {
          filePath: path.resolve(
            projectRoot,
            'src/storage/unsupportedRememoriFileStorage.js',
          ),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
