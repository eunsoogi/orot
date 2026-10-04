import { appendFileSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DATA_VOLUME,
  isGitHubHostedMacOS,
  runSpotlightExperiment,
  verifyRunnerVolumeTopology,
} from './detox-spotlight-experiment.mjs';

function readVolumeTopology(env) {
  const configuredPaths = {
    data: DATA_VOLUME,
    workspace: env.GITHUB_WORKSPACE ?? '',
    simulatorData: join(env.HOME ?? '', 'Library/Developer/CoreSimulator'),
  };
  const paths = {};
  const devices = {};
  const mountPoints = {};

  for (const [name, configuredPath] of Object.entries(configuredPaths)) {
    if (!configuredPath) throw new Error(`${name} path is not configured`);
    paths[name] = realpathSync(configuredPath);
    if (name === 'data' && paths[name] !== DATA_VOLUME) {
      throw new Error(`data path resolved unexpectedly: ${paths[name]}`);
    }
    const details = statSync(paths[name]);
    if (!details.isDirectory()) throw new Error(`${name} path is not a directory`);
    devices[name] = details.dev;

    const mountResult = spawnSync('/bin/df', ['-P', paths[name]], { encoding: 'utf8' });
    if (mountResult.error || mountResult.status !== 0) {
      throw new Error(`${name} mount point could not be read: ${mountResult.stderr || mountResult.error?.message || mountResult.status}`);
    }
    const mountRows = mountResult.stdout.trim().split(/\r?\n/);
    const mountFields = mountRows[1]?.trim().split(/\s+/) ?? [];
    const mountPoint = mountFields.at(-1);
    if (mountRows.length !== 2 || !mountPoint) throw new Error(`${name} mount point output was unrecognized`);
    mountPoints[name] = mountPoint;
  }

  return { paths, devices, mountPoints };
}

function appendOutputValues(env, values) {
  if (!env.GITHUB_OUTPUT) return;
  const output = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  appendFileSync(env.GITHUB_OUTPUT, `${output}\n`);
}

function emit(line, logPath) {
  const text = `${line}\n`;
  process.stdout.write(text);
  if (logPath) appendFileSync(logPath, text);
}

function emitEvidence(event, logPath) {
  if (event.type === 'raw') {
    emit(`mdutil_${event.name}_exit_code=${event.exitCode ?? 'unavailable'}`, logPath);
    if (event.error) emit(`mdutil_${event.name}_spawn_error=${event.error}`, logPath);
    for (const stream of ['stdout', 'stderr']) {
      emit(`mdutil_${event.name}_${stream}_begin`, logPath);
      emit(event[stream].replace(/\n$/, ''), logPath);
      emit(`mdutil_${event.name}_${stream}_end`, logPath);
    }
    return;
  }

  if (event.type === 'state') {
    emit(`mdutil_${event.name}_parsed_state=${event.status}`, logPath);
    return;
  }

  if (event.type === 'action') {
    emit('spotlight_disable_attempted=true', logPath);
    emit(`spotlight_disable_args=${event.args.join(' ')}`, logPath);
    emit(`spotlight_disable_exit_code=${event.exitCode ?? 'unavailable'}`, logPath);
    if (event.error) emit(`spotlight_disable_spawn_error=${event.error}`, logPath);
    for (const stream of ['stdout', 'stderr']) {
      emit(`spotlight_disable_${stream}_begin`, logPath);
      emit(event[stream].replace(/\n$/, ''), logPath);
      emit(`spotlight_disable_${stream}_end`, logPath);
    }
  }
}

function writeUnavailable(env, reason, logPath = null) {
  emit(`spotlight_preflight=unavailable reason=${reason}`, logPath);
  appendOutputValues(env, { status: 'unavailable', attempted: false, verified: false });
}

function main() {
  const env = process.env;
  if (!isGitHubHostedMacOS(env)) {
    writeUnavailable(env, 'not-github-hosted-macos');
    return;
  }

  const logPath = join(env.GITHUB_WORKSPACE ?? process.cwd(), 'artifacts/detox/spotlight-experiment.log');
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, '');

  let topology;
  try {
    topology = readVolumeTopology(env);
  } catch (error) {
    writeUnavailable(env, error.message, logPath);
    return;
  }

  const preflight = verifyRunnerVolumeTopology({ env, ...topology });
  emit(`spotlight_data_path=${topology.paths.data}`, logPath);
  emit(`spotlight_workspace_path=${topology.paths.workspace}`, logPath);
  emit(`spotlight_simulator_data_path=${topology.paths.simulatorData}`, logPath);
  emit(`spotlight_data_device=${topology.devices.data}`, logPath);
  emit(`spotlight_workspace_device=${topology.devices.workspace}`, logPath);
  emit(`spotlight_simulator_data_device=${topology.devices.simulatorData}`, logPath);
  emit(`spotlight_data_mount=${topology.mountPoints.data}`, logPath);
  emit(`spotlight_workspace_mount=${topology.mountPoints.workspace}`, logPath);
  emit(`spotlight_simulator_data_mount=${topology.mountPoints.simulatorData}`, logPath);
  emit(`spotlight_preflight=${preflight.available ? 'available' : 'unavailable'} reason=${preflight.reason}`, logPath);

  if (!preflight.available) {
    appendOutputValues(env, { status: 'unavailable', attempted: false, verified: false });
    return;
  }

  const result = runSpotlightExperiment({
    runMdutil(args) {
      return spawnSync('/usr/bin/mdutil', ['-s', ...args], { encoding: 'utf8' });
    },
    runSudo(args) {
      return spawnSync('/usr/bin/sudo', args, { encoding: 'utf8' });
    },
    onEvidence: (event) => emitEvidence(event, logPath),
  });

  emit(`spotlight_root_status=${result.rootStatus}`, logPath);
  emit(`spotlight_data_status=${result.dataStatus}`, logPath);
  emit(`spotlight_attempted=${result.attempted}`, logPath);
  emit(`spotlight_verified=${result.verified}`, logPath);
  emit(`spotlight_outcome=${result.outcome}`, logPath);
  appendOutputValues(env, {
    status: result.outcome,
    attempted: result.attempted,
    verified: result.verified,
  });
}

export function isDirectExecution(moduleUrl, argvPath) {
  return Boolean(argvPath) && fileURLToPath(moduleUrl) === resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) main();
