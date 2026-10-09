import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const diagnosticPath = path.join(repositoryRoot, 'scripts/ci/cocoapods-null-byte-diagnostic.rb');
const nulPath = '/fixture/react-native\0/ReactCommon';
const preservedException = /IDENTITY=preserved[\s\S]*BACKTRACE=preserved/;

function runCocoapodsFixture({
  basePath,
  sourcePath,
  mutateReceiver = false,
  injectRealdirpathError = false,
  captureFailure = false,
  success = false,
  pnpmSymlinkError = false,
  pnpmSymlinkNulPath = false,
} = {}) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'orot-cocoapods-realdirpath-'));
  if (pnpmSymlinkError || pnpmSymlinkNulPath) {
    // Model the app alias; pnpm error cases inject the recorded error at File.realdirpath.
    const link = path.join(temporaryRoot, 'apps/mobile/node_modules/react-native');
    const store = path.join(temporaryRoot, 'node_modules/.pnpm');
    const target = path.join(store, 'react-native@0.87.1/node_modules/react-native');
    mkdirSync(path.dirname(link), { recursive: true });
    mkdirSync(target, { recursive: true });
    symlinkSync(path.relative(path.dirname(link), target), link);
    basePath = path.join(link, 'ReactCommon');
    sourcePath = path.join(basePath, 'source.h');
  } else if (success) {
    basePath = realpathSync(temporaryRoot);
    sourcePath = path.join(basePath, 'source.h');
  }
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
      '            base_path = ENV["TEST_BASE_PATH"] || "/fixture/react-native\\0/ReactCommon"',
      '            base_path += "\\0" if ENV["TEST_BASE_PATH_NUL"] == "1"',
      '            Pathname.allocate.tap { |path| path.instance_variable_set(:@path, base_path) }',
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
      '    def source_files; [Pathname.new(ENV["TEST_SOURCE_PATH"] || "/fixture/react-native/ReactCommon/source.h")]; end',
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
      'original_file_realdirpath = File.method(:realdirpath)',
      'TEST_REALDIRPATH_ERROR = ArgumentError.new("path name contains null byte")',
      // Mutate Pathname's shared String while retaining its original bytes for Ruby's real NUL rejection.
      'File.define_singleton_method(:realdirpath) do |path, *arguments|',
      '  $TEST_REALDIRPATH_CALLS = ($TEST_REALDIRPATH_CALLS || 0) + 1',
      '  path_at_entry = path.dup',
      '  path.replace("/fixture/mutated") if ENV["TEST_MUTATE_RECEIVER"] == "1"',
      '  begin',
      '    if ENV["TEST_INJECT_REALDIRPATH_ERROR"] == "1"',
      '      raise TEST_REALDIRPATH_ERROR',
      '    else',
      '      original_file_realdirpath.call(path_at_entry, *arguments)',
      '    end',
      '  rescue ArgumentError => error',
      '    $TEST_REALDIRPATH_ERROR = error',
      '    $TEST_REALDIRPATH_BACKTRACE = error.backtrace.dup',
      '    raise',
      '  end',
      'end',
      'if ENV["TEST_CAPTURE_FAILURE"] == "1"',
      '  OrotCocoapodsNullByteDiagnostic.define_singleton_method(:capture_realdirpath_input) do |_path|',
      '    raise IOError, "diagnostic capture failed"',
      '  end',
      'end',
      'installer = Pod::Installer::Xcode::PodsProjectGenerator::FileReferencesInstaller.new',
      'if ENV["TEST_SUCCESS"] == "1"',
      '  references = installer.send(:add_file_accessors_paths_to_pods_group, :source_files, nil, true)',
      '  warn "TEST_SUCCESS_RESULT=" + references.map(&:to_s).inspect + " calls=#{$TEST_REALDIRPATH_CALLS}"',
      'else',
      '  begin',
      '    installer.send(:add_file_accessors_paths_to_pods_group, :source_files, nil, true)',
      '    abort "expected Ruby realdirpath to reject the NUL path"',
      '  rescue ArgumentError => error',
      '    abort "original exception was replaced" unless error.equal?($TEST_PROJECT_ERROR)',
      '    abort "exception identity changed at realdirpath" unless error.equal?($TEST_REALDIRPATH_ERROR)',
      '    abort "original backtrace was replaced" unless error.backtrace == $TEST_REALDIRPATH_BACKTRACE',
      '    warn "TEST_EXCEPTION_IDENTITY=preserved"',
      '    warn "TEST_EXCEPTION_BACKTRACE=preserved"',
      '    raise',
      '  end',
      'end',
    ].join('\n'),
  );

  try {
    const fixtureEnvironment = {
      ...process.env,
      OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC: '1',
      RUBYOPT: '-r' + diagnosticPath,
      TEST_MUTATE_RECEIVER: mutateReceiver ? '1' : '0',
      TEST_INJECT_REALDIRPATH_ERROR:
        pnpmSymlinkError || pnpmSymlinkNulPath || injectRealdirpathError ? '1' : '0',
      TEST_BASE_PATH_NUL: pnpmSymlinkNulPath ? '1' : '0',
      TEST_CAPTURE_FAILURE: captureFailure ? '1' : '0',
      TEST_SUCCESS: success ? '1' : '0',
    };
    if (basePath === undefined) delete fixtureEnvironment.TEST_BASE_PATH;
    else fixtureEnvironment.TEST_BASE_PATH = basePath;
    if (sourcePath === undefined) delete fixtureEnvironment.TEST_SOURCE_PATH;
    else fixtureEnvironment.TEST_SOURCE_PATH = sourcePath;

    return spawnSync('ruby', [runnerPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: fixtureEnvironment,
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
  assert.match(output, preservedException);
  assert.equal(output.includes('\u0000'), false);
});

test('captures the receiver bytes before realdirpath mutates its shared path string', () => {
  const result = runCocoapodsFixture({ mutateReceiver: true });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.match(output, /realdirpath_input="\/fixture\/react-native\\x00\/ReactCommon"/);
  assert.doesNotMatch(output, /realdirpath_input="\/fixture\/mutated"/);
  assert.match(output, preservedException);
});

test('records a NUL-free realdirpath entry when the matching error is raised', () => {
  const basePath = '/fixture/react-native/ReactCommon';
  const result = runCocoapodsFixture({ basePath, injectRealdirpathError: true });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.match(output, /realdirpath_input="\/fixture\/react-native\/ReactCommon"/);
  assert.match(output, new RegExp('realdirpath_input_bytes=' + Buffer.byteLength(basePath)));
  assert.match(output, /realdirpath_input_nul_offsets=none[\s\S]*realdirpath_input_nul_count=0/);
  assert.match(
    output,
    new RegExp('realdirpath_input_scanned_bytes=' + Buffer.byteLength(basePath)),
  );
  assert.match(output, preservedException);
});

test('keeps the original exception and reports unavailable input when capture fails', () => {
  const result = runCocoapodsFixture({ captureFailure: true });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.match(output, /realdirpath_input="<unavailable:IOError>"/);
  assert.match(output, /realdirpath_input_bytes=unavailable/);
  assert.match(output, preservedException);
});

test('uses the pnpm-symlink fallback only after the matching realdirpath error', () => {
  const result = runCocoapodsFixture({ success: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr ?? '', /TEST_SUCCESS_RESULT=\["source\.h"\] calls=1/);

  const fallback = runCocoapodsFixture({ pnpmSymlinkError: true, success: true });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.match(fallback.stderr ?? '', /PNPM_SYMLINK_REALDIRPATH[\s\S]*source\.h.*calls=1/);

  const nulPath = runCocoapodsFixture({ pnpmSymlinkNulPath: true });
  assert.equal(nulPath.status, 1, nulPath.stderr);
  assert.match(nulPath.stderr ?? '', /NULL_BYTE_DIAGNOSTIC.*nul_count=1/);
});
