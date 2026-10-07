#!/usr/bin/env node

import { spawn } from 'node:child_process';

const [timeoutArgument, ...simctlArguments] = process.argv.slice(2);
const timeoutMs = Number(timeoutArgument);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || simctlArguments.length === 0) {
  throw new Error('Usage: run-detox-simctl.mjs <timeout-ms> <simctl arguments...>');
}

const child = spawn('xcrun', ['simctl', ...simctlArguments], {
  detached: true,
  stdio: 'inherit',
});
let timedOut = false;
let spawnFailed = false;
let receivedSignal = null;
let killTimer;
const timeout = setTimeout(() => {
  timedOut = true;
  process.stderr.write(`simctl ${simctlArguments.join(' ')} exceeded ${timeoutMs}ms\n`);
  signalChild('SIGTERM');
  killTimer = setTimeout(() => signalChild('SIGKILL'), 2000);
}, timeoutMs);

function signalChild(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill(signal);
  }
}

function forwardSignal(signal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  signalChild(signal);
  killTimer = setTimeout(() => signalChild('SIGKILL'), 2000);
}

process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));
process.once('SIGHUP', () => forwardSignal('SIGHUP'));

child.on('error', (error) => {
  spawnFailed = true;
  clearTimeout(timeout);
  clearTimeout(killTimer);
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 127;
});

child.on('close', (code, signal) => {
  clearTimeout(timeout);
  clearTimeout(killTimer);
  if (timedOut) {
    process.exitCode = 124;
  } else if (spawnFailed) {
    process.exitCode = 127;
  } else if (receivedSignal) {
    process.exitCode = receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGHUP' ? 129 : 143;
  } else {
    process.exitCode = code ?? (signal ? 128 : 1);
  }
});
