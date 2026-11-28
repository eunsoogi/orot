import { isDeepStrictEqual } from 'node:util';

const rootFields = new Set(['archiveVersion', 'classes', 'objectVersion', 'objects', 'rootObject']);
const objectFields = new Set([
  'attributes',
  'buildConfigurationList',
  'buildConfigurations',
  'buildPhases',
  'buildRules',
  'buildSettings',
  'children',
  'compatibilityVersion',
  'dependencies',
  'fileRef',
  'files',
  'inputFileListPaths',
  'inputPaths',
  'isa',
  'knownRegions',
  'mainGroup',
  'name',
  'outputFileListPaths',
  'outputPaths',
  'packageProductDependencies',
  'packageReferences',
  'path',
  'productReference',
  'projectDirPath',
  'projectReferences',
  'shellPath',
  'shellScript',
  'sourceTree',
  'targets',
]);
const settingFields = new Set([
  'CLANG_ENABLE_MODULES',
  'CODE_SIGNING_ALLOWED',
  'CODE_SIGN_ENTITLEMENTS',
  'CODE_SIGN_STYLE',
  'DEVELOPMENT_TEAM',
  'ENABLE_USER_SCRIPT_SANDBOXING',
  'FRAMEWORK_SEARCH_PATHS',
  'HEADER_SEARCH_PATHS',
  'IPHONEOS_DEPLOYMENT_TARGET',
  'LD_RUNPATH_SEARCH_PATHS',
  'LIBRARY_SEARCH_PATHS',
  'OTHER_CFLAGS',
  'OTHER_LDFLAGS',
  'PRODUCT_BUNDLE_IDENTIFIER',
  'REACT_NATIVE_PATH',
  'SWIFT_VERSION',
]);

function kind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Only fixed field labels and shape changes leave the failing checkout. */
export function projectMetadataDifference(original, current) {
  const fields = new Set();
  const report = (before, after, path, traverse) => {
    if (fields.size >= 8 || isDeepStrictEqual(before, after)) return;
    if (traverse && kind(before) === 'object' && kind(after) === 'object') {
      traverse(before, after, path);
      return;
    }
    const left = kind(before);
    const right = kind(after);
    const change =
      left !== right
        ? `${left}->${right}`
        : left === 'array' && before.length !== after.length
          ? 'length'
          : 'changed';
    fields.add(`${path}:${change}`);
  };
  const compareFields = (before, after, prefix, allowed, nested = {}) => {
    for (const label of allowed) {
      const left = Object.hasOwn(before, label);
      const right = Object.hasOwn(after, label);
      if (left !== right) fields.add(`${prefix}${label}:${right ? 'added' : 'removed'}`);
      else if (left) report(before[label], after[label], prefix + label, nested[label]);
      if (fields.size >= 8) return;
    }
    const extra = new Set([...Object.keys(before), ...Object.keys(after)]);
    if (
      [...extra].some(
        (key) =>
          !allowed.has(key) &&
          (Object.hasOwn(before, key) !== Object.hasOwn(after, key) ||
            !isDeepStrictEqual(before[key], after[key])),
      )
    )
      fields.add(`${prefix}<other>:changed`);
  };
  const compareObjects = (before, after) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const left = Object.hasOwn(before, key);
      const right = Object.hasOwn(after, key);
      if (left !== right) fields.add(`objects.*:${right ? 'added' : 'removed'}`);
      else
        report(before[key], after[key], 'objects.*', (a, b) =>
          compareFields(a, b, 'objects.*.', objectFields, {
            buildSettings: (x, y) => compareFields(x, y, 'objects.*.buildSettings.', settingFields),
          }),
        );
      if (fields.size >= 8) return;
    }
  };
  report(original, current, 'root', (a, b) =>
    compareFields(a, b, '', rootFields, { objects: compareObjects }),
  );
  return `root=${kind(original)}->${kind(current)}; fields=${[...fields].join(',') || 'unclassified'}`;
}
