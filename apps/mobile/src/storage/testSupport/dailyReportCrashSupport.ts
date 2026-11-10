declare const require: (specifier: string) => unknown;
declare const process: { execPath: string };
const { spawnSync } = require('node:child_process') as {
  spawnSync(command: string, args: string[]): { status: number | null };
};

/** Exit with an open write transaction to exercise SQLite recovery in a fresh process. */
export function crashUncommittedPointer(path: string): number | null {
  return spawnSync(process.execPath, [
    '--experimental-sqlite',
    '-e',
    `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO symptom_summary_runs VALUES (?, ?, ?, ?)').run('crashed-run', '2035-01-01T12:02:00Z', 'synthetic', '{}');
    db.prepare('INSERT INTO daily_report_revisions VALUES (?, ?, ?)').run('daily-report:2035-01-01@UTC', 3, 'crashed-run');
    db.prepare('UPDATE daily_report_heads SET active_run_id = ?').run('crashed-run');
    process.exit(23);
  `,
    path,
  ]).status;
}
