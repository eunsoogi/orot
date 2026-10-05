import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function createQualityTools(root) {
  function invoke(command, args, env = process.env) {
    const result = spawnSync(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(command + ' failed with exit code ' + result.status);
    }
  }

  function capture(command, args, env) {
    const result = spawnSync(command, args, {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || command + ' failed');
    }
    return (result.stdout || '').concat(result.stderr || '').trim();
  }

  return { invoke, capture };
}

export function filesFor(entries, surface) {
  return entries
    .filter((entry) => entry.kind === 'surface' && entry.surface === surface)
    .map((entry) => entry.path);
}

export function requireFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
