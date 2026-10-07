import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const diagnosticPath = path.join(repositoryRoot, 'scripts/ci/cocoapods-null-byte-diagnostic.rb');
const failureMessage = 'path name contains null byte';

function workflowStep(workflow, name) {
  const marker = '- name: ' + name;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'workflow step must exist: ' + name);
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

function runDiagnosticFixture({
  enabled = '1',
  message = failureMessage,
  success = false,
  version = '1.17.0',
} = {}) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'orot-cocoapods-diagnostic-'));
  const sourcePath = path.join(
    temporaryRoot,
    'lib/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb',
  );
  const runnerPath = path.join(temporaryRoot, 'run.rb');
  mkdirSync(path.dirname(sourcePath), { recursive: true });

  // This fixture mirrors the pinned CocoaPods 1.17.0 method shape and raises at the file-reference call.
  const fixtureSource = [
    'module Pod',
    "  VERSION = ENV.fetch('TEST_POD_VERSION', '1.17.0')",
    '  module Installer',
    '    module Xcode',
    '      class PodsProjectGenerator',
    '        class FileReferencesInstaller',
    '          def initialize',
    '            @project = TestPodsProject.new',
    '          end',
    '          attr_reader :project',
    '          private',
    '          def file_accessors; [TestFileAccessor.new]; end',
    '          def allowable_project_paths(paths); paths; end',
    '          def sandbox; TestSandbox.new; end',
    '          def preserve_pod_file_structure; true; end',
    '          def common_path(_paths); "/Pods/ReactCore/base\\0dir"; end',
    '          def pods_project; @project; end',
    '          def add_file_accessors_paths_to_pods_group(file_accessor_key, group_key = nil, reflect_file_system_structure = false)',
    '            file_accessors.flat_map do |file_accessor|',
    '              paths = file_accessor.send(file_accessor_key)',
    '              paths = allowable_project_paths(paths)',
    '              next [] if paths.empty?',
    '              pod_name = file_accessor.spec.name',
    '              preserve_pod_file_structure_flag = (sandbox.local?(pod_name) || preserve_pod_file_structure) && reflect_file_system_structure',
    '              base_path = preserve_pod_file_structure_flag ? common_path(paths) : nil',
    '              actual_group_key = preserve_pod_file_structure_flag ? nil : group_key',
    '              group = pods_project.group_for_spec(pod_name, actual_group_key)',
    '              paths.map do |path|',
    '                pods_project.add_file_reference(path, group, preserve_pod_file_structure_flag, base_path)',
    '              end',
    '            end',
    '          end',
    '        end',
    '      end',
    '    end',
    '  end',
    'end',
    'class TestSpec; def name; "ReactCore"; end; end',
    'class TestFileAccessor',
    '  def spec; TestSpec.new; end',
    '  def source_files; ["/Pods/ReactCore/Shared\\0File.h"]; end',
    'end',
    'class TestSandbox; def local?(_pod_name); false; end; end',
    'class TestGroup; def real_path; "/Pods/ReactCore/Groups\\0root"; end; end',
    'TEST_ORIGINAL_ERROR = ArgumentError.new(ENV.fetch("TEST_FAILURE_MESSAGE", "path name contains null byte"))',
    'class TestPodsProject',
    '  attr_reader :calls',
    '  def initialize; @calls = 0; end',
    '  def group_for_spec(_pod_name, _group_key); TestGroup.new; end',
    '  def add_file_reference(_path, _group, _preserve, _base_path)',
    '    @calls += 1',
    '    return "file reference" if ENV["TEST_SUCCESS"] == "1"',
    '    raise TEST_ORIGINAL_ERROR',
    '  end',
    'end',
    'installer = Pod::Installer::Xcode::PodsProjectGenerator::FileReferencesInstaller.new',
    'begin',
    '  references = installer.send(:add_file_accessors_paths_to_pods_group, :source_files, nil, true)',
    '  warn "TEST_SUCCESS_RESULT=" + references.inspect',
    'rescue ArgumentError => error',
    '  abort "original exception was replaced" unless error.equal?(TEST_ORIGINAL_ERROR)',
    '  warn "TEST_EXCEPTION_IDENTITY=preserved"',
    '  warn "TEST_REFERENCE_CALLS=" + installer.project.calls.to_s',
    '  raise',
    'end',
  ].join('\n');
  const runnerSource = 'require ' + JSON.stringify(sourcePath) + '\n';
  writeFileSync(sourcePath, fixtureSource);
  writeFileSync(runnerPath, runnerSource);

  try {
    const result = spawnSync('ruby', [runnerPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC: enabled,
        RUBYOPT: '-r' + diagnosticPath,
        TEST_FAILURE_MESSAGE: message,
        TEST_POD_VERSION: version,
        TEST_SUCCESS: success ? '1' : '0',
      },
    });
    return result;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('enables the Ruby hook only on the Detox CocoaPods install step', () => {
  const workflow = readFileSync(
    path.join(repositoryRoot, '.github/workflows/detox-e2e-profile.yml'),
    'utf8',
  );
  const step = workflowStep(workflow, 'Install Detox CocoaPods dependencies');

  assert.match(step, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC=1/);
  assert.match(step, /RUBYOPT=/);
  assert.match(step, /cocoapods-null-byte-diagnostic\.rb/);
  assert.equal((workflow.match(/OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC/g) ?? []).length, 1);
});

test('logs escaped file-reference context and preserves the original null-byte exception', () => {
  const result = runDiagnosticFixture();
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.match(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC version=1\.17\.0/);
  assert.match(output, /pod="ReactCore"/);
  assert.match(output, /accessor_key=:source_files/);
  assert.match(output, /absolute_pathname=.*\\(?:x00|u0000)/);
  assert.match(output, /base_path=.*\\(?:x00|u0000)/);
  assert.match(output, /group_real_path=.*\\(?:x00|u0000)/);
  assert.equal(output.includes('\u0000'), false);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
  assert.match(output, /TEST_REFERENCE_CALLS=1/);
  assert.match(output, /path name contains null byte/);
  assert.match(output, /file_references_installer\.rb/);
});

test('leaves the original error untouched when the diagnostic is opted out', () => {
  const result = runDiagnosticFixture({ enabled: '0' });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.doesNotMatch(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC/);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
  assert.match(output, /TEST_REFERENCE_CALLS=1/);
});

test('ignores unrelated file-reference errors when opted in', () => {
  const result = runDiagnosticFixture({ message: 'unrelated file-accessor error' });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.doesNotMatch(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC/);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
});

test('keeps successful file-reference installation unchanged when opted in', () => {
  const result = runDiagnosticFixture({ success: true });
  const output = result.stderr ?? '';

  assert.equal(result.status, 0, output);
  assert.match(output, /TEST_SUCCESS_RESULT=\["file reference"\]/);
  assert.doesNotMatch(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC/);
});

test('does not patch a CocoaPods version outside the pinned diagnostic target', () => {
  const result = runDiagnosticFixture({ version: '1.18.0' });
  const output = result.stderr ?? '';

  assert.equal(result.status, 1, output);
  assert.doesNotMatch(output, /OROT_COCOAPODS_NULL_BYTE_DIAGNOSTIC/);
  assert.match(output, /TEST_EXCEPTION_IDENTITY=preserved/);
});
