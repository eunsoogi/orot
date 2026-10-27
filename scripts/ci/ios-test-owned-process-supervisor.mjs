import { execFileSync } from 'node:child_process';

/** Preserve process start identity across snapshots; a recycled PID never inherits ownership. */
export function readProcessSnapshot() {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,comm='], {
    encoding: 'utf8',
    timeout: 2000,
  });
  return text.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/);
    return match
      ? [
          {
            pid: +match[1],
            parent: +match[2],
            group: +match[3],
            state: match[4],
            identity: match[5],
            command: match[6],
          },
        ]
      : [];
  });
}

/** Follow descendants even when canonical runners create nested groups; never signal a whole group. */
export class OwnedProcessSupervisor {
  constructor(
    root,
    { snapshot = readProcessSnapshot, signal = process.kill, emit = () => {} } = {},
  ) {
    this.snapshot = snapshot;
    this.signal = signal;
    this.emit = emit;
    this.owned = new Map([[root.pid, root]]);
    this.root = root;
    this.uncertain = false;
  }

  observe() {
    const rows = this.snapshot();
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        const parent = this.owned.get(row.parent);
        const actualParent = rows.find((item) => item.pid === row.parent);
        if (!this.owned.has(row.pid) && parent && actualParent?.identity === parent.identity) {
          this.owned.set(row.pid, row);
          changed = true;
        }
      }
    }
    return rows.filter((row) => this.owned.get(row.pid)?.identity === row.identity);
  }

  /** Zombies are terminal writers. EPERM is a supervision failure, never evidence of absence. */
  send(row, signal) {
    if (row.state.startsWith('Z')) return;
    try {
      this.signal(row.pid, signal);
      this.emit({ event: 'owned-process-signal', pid: row.pid, signal });
    } catch (error) {
      if (error.code !== 'ESRCH') {
        this.uncertain = true;
        this.emit({ event: 'owned-signal-failed', pid: row.pid, signal, code: error.code });
      }
    }
  }

  interrupt() {
    const live = this.observe();
    // The canonical root forwards SIGINT to its own session; do not pause it or double-signal nested writers.
    const root = live.find((row) => row.pid === this.root.pid);
    if (root) this.send(root, 'SIGINT');
    else for (const row of live) this.send(row, 'SIGINT');
  }

  escalate(signal) {
    if (!['SIGTERM', 'SIGKILL'].includes(signal)) throw new Error('Unsupported owned escalation');
    for (const row of this.observe()) this.send(row, signal);
  }

  cleanupReceipt() {
    const live = this.observe().filter((row) => !row.state.startsWith('Z'));
    return {
      writersStopped: !this.uncertain && live.length === 0,
      supervisionUncertain: this.uncertain,
      livePIDs: live.map((row) => row.pid),
    };
  }
}
