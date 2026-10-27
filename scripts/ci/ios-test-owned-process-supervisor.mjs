import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const psArguments = ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,comm='];
const psOptions = { encoding: 'utf8', timeout: 2000, env: { ...process.env, LC_ALL: 'C' } };
function parseSnapshot(text) {
  if (!text.trim()) throw new Error('Process snapshot is empty');
  return text
    .trimEnd()
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/);
      if (!match) throw new Error('Process snapshot is incomplete');
      return {
        pid: +match[1],
        parent: +match[2],
        group: +match[3],
        state: match[4],
        identity: match[5],
        command: match[6],
      };
    });
}

/** Synchronous reads are for bounded host controls, never the execution deadline path. */
export function readProcessSnapshot() {
  return parseSnapshot(execFileSync('ps', psArguments, psOptions));
}
export async function readProcessSnapshotAsync() {
  return parseSnapshot((await promisify(execFile)('ps', psArguments, psOptions)).stdout);
}

/** Only explicitly registered canonical groups can prove termination; empty ancestry is never proof. */
export class OwnedProcessSupervisor {
  constructor(
    root,
    {
      snapshot = readProcessSnapshotAsync,
      signal = process.kill,
      emit = () => {},
      expectedGroups = 1,
    } = {},
  ) {
    this.snapshot = snapshot;
    this.signal = signal;
    this.emit = emit;
    this.groups = new Map();
    this.attempts = new Set();
    this.registered = new Set();
    this.expectedGroups = expectedGroups;
    this.closed = false;
    this.uncertain = false;
    this.firstUncertainty = null;
    this.rootVerified = false;
    if (root) this.registerRoot(root);
  }

  /** Preserve the first actual branch and scalar context so later cleanup failures cannot mask it. */
  markUncertain(reason, context = {}) {
    this.uncertain = true;
    this.firstUncertainty ??= Object.freeze({
      reason,
      expectedGroupCount: this.expectedGroups,
      attemptCount: this.attempts.size,
      registeredGroupCount: this.registered.size,
      ...context,
    });
  }

  registerRoot(root) {
    if (!this.validIdentity(root)) {
      this.markUncertain('invalid-root-identity');
      return;
    }
    this.rootVerified = true;
    this.emit({
      event: 'owned-root-identity',
      pid: root.pid,
      group: root.group,
      identity: root.identity,
    });
    this.groups.set(root.group, {
      leader: root,
      members: new Map([[root.pid, root]]),
      retired: false,
    });
  }

  validIdentity(row) {
    return (
      Number.isSafeInteger(row?.pid) &&
      row.pid > 0 &&
      row.group === row.pid &&
      typeof row.identity === 'string' &&
      row.identity.length === 24
    );
  }

  registration(event) {
    const sequence = event.attemptSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > this.expectedGroups) {
      this.markUncertain('registration-sequence-out-of-range');
      return;
    }
    if (event.phase === 'attempt' && !this.attempts.has(sequence)) this.attempts.add(sequence);
    else if (
      event.phase === 'spawned' &&
      this.attempts.has(sequence) &&
      !this.registered.has(sequence) &&
      this.validIdentity(event) &&
      !this.groups.has(event.group)
    ) {
      this.registered.add(sequence);
      this.emit({
        event: 'owned-group-registered',
        pid: event.pid,
        group: event.group,
        identity: event.identity,
        attemptSequence: sequence,
      });
      this.groups.set(event.group, {
        leader: event,
        members: new Map([[event.pid, event]]),
        retired: false,
      });
    } else {
      const phase = ['attempt', 'spawned', 'failed'].includes(event.phase) ? event.phase : 'other';
      this.markUncertain('registration-event-rejected', { phase });
    }
  }

  closeRegistrations(partial = false) {
    this.closed = true;
    if (
      partial ||
      this.attempts.size !== this.expectedGroups ||
      this.registered.size !== this.expectedGroups
    )
      this.markUncertain('registrations-incomplete', { partial });
  }

  async observe() {
    const groups = [...this.groups.values()];
    let rows;
    try {
      rows = await this.snapshot();
    } catch {
      this.markUncertain('process-snapshot-unavailable');
      this.unverifiedLive = true;
      return [];
    }
    const owned = [];
    this.unverifiedLive = false;
    for (const group of groups) {
      if (group.retired) continue;
      const leader = rows.find((row) => row.pid === group.leader.pid);
      if (
        leader &&
        (leader.identity !== group.leader.identity || leader.group !== group.leader.group)
      ) {
        this.markUncertain(
          leader.identity !== group.leader.identity
            ? 'leader-start-identity-changed'
            : 'leader-process-group-changed',
        );
        this.unverifiedLive ||= rows.some(
          (row) => row.group === group.leader.group && !row.state.startsWith('Z'),
        );
        continue;
      }
      const members = rows.filter((row) => row.group === group.leader.group);
      if (!members.length) {
        group.retired = true;
        continue;
      }
      for (const row of members) {
        const known = group.members.get(row.pid);
        if ((known && known.identity !== row.identity) || (!known && !leader)) {
          this.markUncertain(
            known ? 'member-start-identity-changed' : 'member-unregistered-after-leader-exit',
          );
          this.unverifiedLive ||= !row.state.startsWith('Z');
          continue;
        }
        group.members.set(row.pid, row);
        owned.push(row);
      }
    }
    return owned;
  }

  /** First interruption belongs to the retained ChildProcess handle outside this observer. */
  async escalate(signal) {
    if (!['SIGTERM', 'SIGKILL'].includes(signal)) throw new Error('Unsupported owned escalation');
    const owned = await this.observe();
    let fresh;
    try {
      fresh = await this.snapshot();
    } catch {
      this.markUncertain('escalation-snapshot-unavailable', { signal });
      return;
    }
    for (const row of owned) {
      if (row.state.startsWith('Z')) continue;
      const current = fresh.find((item) => item.pid === row.pid);
      if (!current) continue;
      if (current.identity !== row.identity || current.group !== row.group) {
        this.markUncertain(
          current.identity !== row.identity
            ? 'process-start-identity-changed-before-signal'
            : 'process-group-changed-before-signal',
          { signal },
        );
        continue;
      }
      if (current.state.startsWith('Z')) continue;
      try {
        this.signal(row.pid, signal);
      } catch (error) {
        if (error.code === 'ESRCH') continue;
        const reason =
          error.code === 'EPERM' ? 'process-signal-permission-denied' : 'process-signal-failed';
        this.markUncertain(reason, { signal });
        this.emit({ event: 'owned-signal-failed', pid: row.pid, signal, code: error.code });
        continue;
      }
      try {
        this.emit({ event: 'owned-process-signal', pid: row.pid, signal });
      } catch {
        // Reporting failed after the signal call; preserve that boundary instead of claiming the OS denied the signal.
        this.markUncertain('process-signal-report-failed', { signal });
      }
    }
  }

  async cleanupReceipt() {
    const live = (await this.observe()).filter((row) => !row.state.startsWith('Z'));
    const registeredWritersStopped = live.length === 0 && !this.unverifiedLive;
    const complete =
      this.closed && this.rootVerified && this.registered.size === this.expectedGroups;
    return {
      writersStopped: complete && !this.uncertain && registeredWritersStopped,
      registeredWritersStopped,
      supervisionUncertain: this.uncertain || !complete,
      firstUncertainty: this.firstUncertainty,
      livePIDs: live.map((row) => row.pid),
      registeredGroups: this.registered.size,
    };
  }
}
