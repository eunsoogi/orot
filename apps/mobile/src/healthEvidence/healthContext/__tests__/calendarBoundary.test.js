const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Allow cold compiler loading under hosted load; each child still has a hard watchdog.
jest.setTimeout(40_000);

// Compile the actual calendar/window and domain parser inside a killable process.
// A synchronous regression must fail this test rather than block the Jest worker.
const root = path.resolve(__dirname, '../../../../../..');
const harness = `
const fs = require('fs');
const ts = require(${JSON.stringify(require.resolve('typescript'))});
const Module = require('module');
const original = Module.prototype.require;
Module.prototype.require = function(name) {
  return original.call(this, name === '@orot/domain' ? ${JSON.stringify(path.join(root, 'packages/domain/src/common.ts'))} : name);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const {healthContextDays} = require(${JSON.stringify(path.join(root, 'apps/mobile/src/healthEvidence/healthContext/window.ts'))});
process.stdout.write(JSON.stringify(healthContextDays(JSON.parse(process.argv[1]))));
`;

function days(fromInclusive, toExclusive, timeZone) {
  const result = spawnSync(
    process.execPath,
    ['-e', harness, JSON.stringify({ fromInclusive, toExclusive, timeZone })],
    { timeout: 10_000, encoding: 'utf8' },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('upper four-digit local calendar boundary terminates with exact partial days', () => {
  expect(
    days('9999-12-30T00:00:00Z', '9999-12-31T00:00:00Z', 'Asia/Seoul'),
  ).toEqual([
    {
      date: '9999-12-30',
      fromInclusive: '9999-12-30T00:00:00Z',
      toExclusive: '9999-12-30T15:00:00.000Z',
      partial: true,
    },
    {
      date: '9999-12-31',
      fromInclusive: '9999-12-30T15:00:00.000Z',
      toExclusive: '9999-12-31T00:00:00Z',
      partial: true,
    },
  ]);
});

test.each([
  ['UTC', ['9999-12-30']],
  ['America/New_York', ['9999-12-29', '9999-12-30']],
])('neighboring upper dates terminate in %s', (zone, expected) => {
  const result = days('9999-12-30T00:00:00Z', '9999-12-31T00:00:00Z', zone);
  expect(result.map(day => day.date)).toEqual(expected);
  expect(
    result.reduce(
      (sum, day) =>
        sum + Date.parse(day.toExclusive) - Date.parse(day.fromInclusive),
      0,
    ),
  ).toBe(86_400_000);
});

test('timezone conversion may reach an expanded local year without truncating it', () => {
  const result = days(
    '9999-12-31T14:00:00Z',
    '9999-12-31T16:00:00Z',
    'Asia/Seoul',
  );
  expect(result.map(day => day.date)).toEqual(['9999-12-31', '+010000-01-01']);
  expect(result[0]?.toExclusive).toBe('9999-12-31T15:00:00.000Z');
  expect(result[1]?.fromInclusive).toBe('9999-12-31T15:00:00.000Z');
  expect(result[1]?.toExclusive).toBe('9999-12-31T16:00:00Z');
});

test('year zero and negative local years keep astronomical ordering', () => {
  const result = days(
    '0000-01-01T00:00:00Z',
    '0000-01-02T00:00:00Z',
    'Etc/GMT+5',
  );
  expect(result.map(day => day.date)).toEqual(['-000001-12-31', '0000-01-01']);
  expect(result[0]?.toExclusive).toBe('0000-01-01T05:00:00.000Z');
});

test('the domain parser still rejects externally supplied expanded timestamps', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      harness,
      JSON.stringify({
        fromInclusive: '+010000-01-01T00:00:00Z',
        toExclusive: '+010000-01-02T00:00:00Z',
        timeZone: 'UTC',
      }),
    ],
    { timeout: 10_000, encoding: 'utf8' },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Invalid ISO datetime');
});

test('DST and a skipped civil day retain exact elapsed intervals', () => {
  const spring = days(
    '2026-03-07T05:00:00Z',
    '2026-03-10T04:00:00Z',
    'America/New_York',
  );
  expect(
    spring.map(
      day =>
        (Date.parse(day.toExclusive) - Date.parse(day.fromInclusive)) /
        3_600_000,
    ),
  ).toEqual([24, 23, 24]);
  const fall = days(
    '2026-10-31T04:00:00Z',
    '2026-11-03T05:00:00Z',
    'America/New_York',
  );
  expect(
    fall.map(
      day =>
        (Date.parse(day.toExclusive) - Date.parse(day.fromInclusive)) /
        3_600_000,
    ),
  ).toEqual([24, 25, 24]);
  expect(
    days('2011-12-29T10:00:00Z', '2011-12-31T10:00:00Z', 'Pacific/Apia').map(
      day => day.date,
    ),
  ).toEqual(['2011-12-29', '2011-12-31']);
});
