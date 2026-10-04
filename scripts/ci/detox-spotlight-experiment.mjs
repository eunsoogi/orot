export const ROOT_VOLUME = '/';
export const DATA_VOLUME = '/System/Volumes/Data';

const noOp = () => {};

export function isGitHubHostedMacOS(env) {
  return env?.GITHUB_ACTIONS === 'true' &&
    env?.RUNNER_OS === 'macOS' &&
    env?.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env?.CI === 'true';
}

function normalizeCommandResult(result) {
  return {
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    stdout: typeof result?.stdout === 'string' ? result.stdout : '',
    stderr: typeof result?.stderr === 'string' ? result.stderr : '',
    error: result?.error instanceof Error ? result.error.message : '',
  };
}

function invoke(command, args) {
  try {
    return normalizeCommandResult(command(args));
  } catch (error) {
    return normalizeCommandResult({ error });
  }
}

function statusFromLine(line) {
  const status = line.trim();
  if (status === 'Indexing enabled.' || status === 'Indexing enabled') return 'enabled';
  if (status === 'Indexing disabled.' || status === 'Indexing disabled') return 'disabled';
  if (status === 'Index is read-only.' || status === 'Index is read-only') return 'read-only';
  return 'unknown';
}

export function parseMdutilStatus(volume, rawOutput) {
  if (typeof volume !== 'string' || !volume.startsWith('/') || typeof rawOutput !== 'string') return 'unknown';

  const normalized = rawOutput.replace(/\r\n?/g, '\n');
  const statuses = [];
  let targetBlocks = 0;
  let activeVolume = null;
  let hasUnknownLine = false;

  for (const sourceLine of normalized.split('\n')) {
    const line = sourceLine.trim();
    if (line.length === 0) continue;

    const header = /^([^:]+):(?:[ \t]*(.*))?$/.exec(line);
    if (header && header[1].startsWith('/')) {
      if (header[1] !== ROOT_VOLUME && header[1] !== DATA_VOLUME) {
        activeVolume = null;
        hasUnknownLine = true;
        continue;
      }

      activeVolume = header[1];
      if (activeVolume === volume) targetBlocks += 1;
      if (header[2]) {
        const status = statusFromLine(header[2]);
        if (status === 'unknown') hasUnknownLine = true;
        else if (activeVolume === volume) statuses.push(status);
      }
      continue;
    }

    if (!activeVolume) {
      hasUnknownLine = true;
      continue;
    }

    const status = statusFromLine(line);
    if (status === 'unknown') hasUnknownLine = true;
    else if (activeVolume === volume) statuses.push(status);
  }

  if (targetBlocks !== 1 || hasUnknownLine || statuses.length !== 1) return 'unknown';
  return statuses[0];
}

export function verifyRunnerVolumeTopology({ env, paths, devices, mountPoints }) {
  if (!isGitHubHostedMacOS(env)) {
    return { available: false, reason: 'not-github-hosted-macos' };
  }

  if (!paths?.data || !paths?.workspace || !paths?.simulatorData) {
    return { available: false, reason: 'required-path-missing' };
  }

  if (paths.data !== DATA_VOLUME) {
    return { available: false, reason: 'data-volume-path-not-exact' };
  }

  if (!mountPoints || mountPoints.data == null || mountPoints.workspace == null || mountPoints.simulatorData == null) {
    return { available: false, reason: 'mount-point-unavailable' };
  }

  if (mountPoints.data !== DATA_VOLUME || mountPoints.workspace !== DATA_VOLUME || mountPoints.simulatorData !== DATA_VOLUME) {
    return { available: false, reason: 'mount-point-mismatch' };
  }

  if (!devices || devices.data == null || devices.workspace == null || devices.simulatorData == null) {
    return { available: false, reason: 'volume-device-unavailable' };
  }

  if (devices.data !== devices.workspace || devices.data !== devices.simulatorData) {
    return { available: false, reason: 'workspace-or-simulator-data-on-different-volume' };
  }

  return { available: true, reason: 'verified-data-volume' };
}

export function runSpotlightExperiment({ runMdutil, runSudo, onEvidence = noOp }) {
  const observations = [];
  let suppression = null;

  function observe(name, volume) {
    const command = invoke((args) => runMdutil(args), [volume]);
    const raw = { type: 'raw', name, volume, ...command };
    onEvidence(raw);

    const status = command.exitCode === 0
      ? parseMdutilStatus(volume, [command.stdout, command.stderr].filter(Boolean).join('\n'))
      : 'command-failure';
    const observation = { name, volume, ...command, status };
    observations.push(observation);
    onEvidence({ type: 'state', name, volume, status, exitCode: command.exitCode });
    return observation;
  }

  const root = observe('root', ROOT_VOLUME);
  const dataBefore = observe('data-before', DATA_VOLUME);

  if (dataBefore.status === 'disabled') {
    return {
      rootStatus: root.status,
      dataStatus: dataBefore.status,
      dataAfter: null,
      suppression: null,
      attempted: false,
      verified: false,
      outcome: 'already-disabled',
      observations,
    };
  }

  if (dataBefore.status !== 'enabled') {
    return {
      rootStatus: root.status,
      dataStatus: dataBefore.status,
      dataAfter: null,
      suppression: null,
      attempted: false,
      verified: false,
      outcome: 'unavailable',
      observations,
    };
  }

  const args = ['-n', '/usr/bin/mdutil', '-i', 'off', DATA_VOLUME];
  suppression = { ...invoke(runSudo, args), args };
  onEvidence({ type: 'action', ...suppression });
  const dataAfter = observe('data-after', DATA_VOLUME);
  const verified = suppression.exitCode === 0 && dataAfter.status === 'disabled';

  return {
    rootStatus: root.status,
    dataStatus: dataBefore.status,
    dataAfter,
    suppression,
    attempted: true,
    verified,
    outcome: verified ? 'disabled-and-verified' : 'attempted-unverified',
    observations,
  };
}
