import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const diagnosticPath = path.join(repositoryRoot, 'scripts/ci/cocoapods-null-byte-diagnostic.rb');
const nulPath = '/fixture/react-native\0/ReactCommon';

function runCocoapodsFixture() {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'orot-cocoapods-realdirpath-'));
  const projectSourcePath = path.join(temporaryRoot, 'gems/cocoapods/lib/cocoapods/project.rb');
  const installerSourcePath = path.join(
    temporaryRoot,
    'gems/cocoapods/lib/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb',
  );
  const runnerPath = path.join(temporaryRoot, 'run.rb');
  mkdirSync(path.dirname(projectSourcePath), { recursive: true });
  mkdirSync(path.dirname(installerSourcePath), { recursive: true });

  // Exercise the real Ruby NUL rejection at the Pathname boundary; this is recorder coverage, not a production reproduction.
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
      '          def common_path(_paths)',
      '            Pathname.allocate.tap { |path| path.instance_variable_set(:@path, "/fixture/react-native\\0/ReactCommon") }',
      '          end',
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
      '    def source_files; [Pathname.new("/fixture/react-native/ReactCommon/source.h")]; end',
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
      'installer = Pod::Installer::Xcode::PodsProjectGenerator::FileReferencesInstaller.new',
      'begin',
      '  installer.send(:add_file_accessors_paths_to_pods_group, :source_files, nil, true)',
      '  abort "expected Ruby realdirpath to reject the NUL path"',
      'rescue ArgumentError => error',
      '  abort "original exception was replaced" unless error.equal?($TEST_PROJECT_ERROR)',
      '  warn "TEST_EXCEPTION_IDENTITY=preserved"',
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
      },
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('captures the failed realdirpath receiver as escaped bytes and preserves the original error', () => {
  const result = runCocoapodsFixture();
  const output = result.stderr ?? '';
  const nulOffset = Buffer.byteLength('/fixture/react-native');

  assert.equal(result.status, 1, output);
  assert.match(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC version=1\.17\.0/);
  assert.match(output, /realdirpath_input="\/fixture\/react-native\\x00\/ReactCommon"/);
  assert.match(
    output,
    new RegExp(`realdirpath_input_bytes=${Buffer.byteLength(nulPath)}(?:\\s|$)`),
  );
  assert.match(output, new RegExp(`realdirpath_input_nul_offsets=${nulOffset}(?:\\s|$)`));
  assert.match(output, /realdirpath_input_nul_count=1/);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
  assert.equal(output.includes('\u0000'), false);
});
