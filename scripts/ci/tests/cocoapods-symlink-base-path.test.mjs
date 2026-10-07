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

function runProjectFixture({ useSymlink, failRealpath = false }) {
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
      '    Group = Struct.new(:real_path)',
      '    def group_for_spec(_pod_name, _group_key); Group.new("/Pods/ReactNative"); end',
      '    def add_file_reference(path, group, reflect_file_system_structure, base_path)',
      '      group_for_path_in_group(path, group, reflect_file_system_structure, base_path)',
      '    rescue ArgumentError => error',
      '      $TEST_PROJECT_ERROR = error',
      '      raise',
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
      '          def initialize; @project = Pod::Project.new; end',
      '          def file_accessors; [TestFileAccessor.new]; end',
      '          def allowable_project_paths(paths); paths; end',
      '          def sandbox; TestSandbox.new; end',
      '          def preserve_pod_file_structure; true; end',
      '          def common_path(_paths); Pathname.new(ENV.fetch("TEST_BASE_PATH")); end',
      '          def pods_project; @project; end',
      '          def add_file_accessors_paths_to_pods_group(*)',
      '            raise "diagnostic patch unavailable"',
      '          end',
      '        end',
      '      end',
      '    end',
      '  end',
      '  class TestSpec; def name; "ReactNative"; end; end',
      '  class TestFileAccessor',
      '    def spec; TestSpec.new; end',
      '    def source_files; [Pathname.new(ENV.fetch("TEST_SOURCE_PATH"))]; end',
      '  end',
      '  class TestSandbox; def local?(_pod_name); true; end; end',
      'end',
    ].join('\n'),
  );
  writeFileSync(
    runnerPath,
    [
      'require ' + JSON.stringify(projectSourcePath),
      'require ' + JSON.stringify(installerSourcePath),
      '$TEST_REALDIRPATH_CALLS = 0',
      '$TEST_ORIGINAL_ERROR = ArgumentError.new("path name contains null byte")',
      'module TestPathnameRealpathProbe',
      '  def realdirpath',
      '    $TEST_REALDIRPATH_CALLS += 1',
      '    raise $TEST_ORIGINAL_ERROR if ENV["TEST_FAIL_REALPATH"] == "1"',
      '    super',
      '  end',
      'end',
      'Pathname.prepend(TestPathnameRealpathProbe)',
      'installer = Pod::Installer::Xcode::PodsProjectGenerator::FileReferencesInstaller.new',
      'begin',
      '  references = installer.send(:add_file_accessors_paths_to_pods_group, :source_files, nil, true)',
      '  puts "TEST_REALDIRPATH_CALLS=#{$TEST_REALDIRPATH_CALLS}"',
      '  puts "TEST_RELATIVE_PATHS=#{references.inspect}"',
      'rescue ArgumentError => error',
      '  abort "original exception was replaced" unless error.equal?($TEST_ORIGINAL_ERROR) && error.equal?($TEST_PROJECT_ERROR)',
      '  warn "TEST_EXCEPTION_IDENTITY=preserved"',
      '  warn "TEST_REALDIRPATH_CALLS=#{$TEST_REALDIRPATH_CALLS}"',
      '  raise',
      'end',
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
        TEST_FAIL_REALPATH: failRealpath ? '1' : '0',
      },
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

test('keeps file grouping lexical when source and base share an isolated package symlink', () => {
  const result = runProjectFixture({ useSymlink: true });
  assert.equal(result.status, 0, result.stderr ?? 'Ruby fixture failed');
  assert.match(result.stdout ?? '', /TEST_REALDIRPATH_CALLS=0/);
  assert.match(result.stdout ?? '', /TEST_RELATIVE_PATHS=.*BoundedRequestBuffer\.h/);
});

test('keeps ordinary real paths unchanged when the package path has no symlink', () => {
  const result = runProjectFixture({ useSymlink: false });
  assert.equal(result.status, 0, result.stderr ?? 'Ruby fixture failed');
  assert.match(result.stdout ?? '', /TEST_REALDIRPATH_CALLS=1/);
  assert.match(result.stdout ?? '', /TEST_RELATIVE_PATHS=.*BoundedRequestBuffer\.h/);
});

test('keeps the original realpath error and diagnostic on an ordinary path', () => {
  // Inject the CI error at Pathname#realdirpath without constructing an invalid Pathname.
  const result = runProjectFixture({ useSymlink: false, failRealpath: true });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.match(
    output,
    /TEST_REALDIRPATH_CALLS=1/,
  );
  assert.match(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC version=1\.17\.0/);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
  assert.match(output, /path name contains null byte/);
});
