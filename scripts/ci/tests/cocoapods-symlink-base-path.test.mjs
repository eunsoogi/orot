import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const diagnosticPath = path.join(repositoryRoot, 'scripts/ci/cocoapods-null-byte-diagnostic.rb');

function runProjectFixture({ useSymlink }) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'orot-cocoapods-symlink-'));
  const temporaryRoot = realpathSync(temporaryDirectory);
  const projectSourcePath = path.join(temporaryRoot, 'gems/cocoapods/lib/cocoapods/project.rb');
  const installerSourcePath = path.join(
    temporaryRoot,
    'gems/cocoapods/lib/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb',
  );
  const runnerPath = path.join(temporaryRoot, 'run.rb');
  const storePath = path.join(
    temporaryRoot,
    'apps/mobile/node_modules/.pnpm/react-native@0.87.1/node_modules/react-native',
  );
  const linkedPath = path.join(temporaryRoot, 'apps/mobile/node_modules/react-native');
  const packagePath = useSymlink ? linkedPath : path.join(temporaryRoot, 'apps/mobile/react-native');
  const basePath = path.join(packagePath, 'ReactCommon/jsinspector-modern/network');
  const sourcePath = path.join(basePath, 'BoundedRequestBuffer.h');

  mkdirSync(path.dirname(projectSourcePath), { recursive: true });
  mkdirSync(path.dirname(installerSourcePath), { recursive: true });
  if (useSymlink) {
    const storeSourcePath = path.join(
      storePath,
      'ReactCommon/jsinspector-modern/network/BoundedRequestBuffer.h',
    );
    mkdirSync(path.dirname(storeSourcePath), { recursive: true });
    writeFileSync(storeSourcePath, '');
    symlinkSync(storePath, linkedPath, 'dir');
  } else {
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, '');
  }

  // These are the pinned CocoaPods 1.17.0 path-resolution statements at the failing boundary.
  writeFileSync(
    projectSourcePath,
    [
      'require "pathname"',
      'module Pod',
      "  VERSION = '1.17.0'",
      '  class Project',
      '    def group_for_path_in_group(absolute_pathname, group, _reflect_file_system_structure, base_path = nil)',
      '      relative_base = base_path.nil? ? group.real_path : base_path.realdirpath',
      '      absolute_pathname.relative_path_from(relative_base)',
      '    end',
      '  end',
      'end',
    ].join('\n'),
  );
  writeFileSync(
    installerSourcePath,
    [
      'module Pod',
      '  module Installer',
      '    module Xcode',
      '      class PodsProjectGenerator',
      '        class FileReferencesInstaller',
      '          def add_file_accessors_paths_to_pods_group; end',
      '        end',
      '      end',
      '    end',
      '  end',
      'end',
    ].join('\n'),
  );
  writeFileSync(
    runnerPath,
    [
      'require ' + JSON.stringify(projectSourcePath),
      'require ' + JSON.stringify(installerSourcePath),
      'project = Pod::Project.new',
      'result = project.group_for_path_in_group(Pathname.new(ENV.fetch("TEST_SOURCE_PATH")), Object.new, true, Pathname.new(ENV.fetch("TEST_BASE_PATH")))',
      'puts "TEST_RELATIVE_PATH=#{result}"',
    ].join('\n'),
  );

  try {
    return spawnSync('ruby', [runnerPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC: '1',
        RUBYOPT: '-r' + diagnosticPath,
        TEST_SOURCE_PATH: sourcePath,
        TEST_BASE_PATH: basePath,
      },
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

test('keeps file grouping lexical when source and base share an isolated package symlink', () => {
  const result = runProjectFixture({ useSymlink: true });
  assert.equal(result.status, 0, result.stderr ?? 'Ruby fixture failed');
  assert.match(result.stdout ?? '', /TEST_RELATIVE_PATH=BoundedRequestBuffer\.h/);
});

test('keeps ordinary real paths unchanged when the package path has no symlink', () => {
  const result = runProjectFixture({ useSymlink: false });
  assert.equal(result.status, 0, result.stderr ?? 'Ruby fixture failed');
  assert.match(result.stdout ?? '', /TEST_RELATIVE_PATH=BoundedRequestBuffer\.h/);
});
