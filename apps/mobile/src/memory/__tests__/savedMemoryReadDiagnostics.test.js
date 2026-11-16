import { providerDiagnostic } from '../../providers/diagnostics';
import { observeSavedMemoryRead } from '../savedMemoryReadDiagnostics';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';

// Jest's RN preset leaves lazy imports to Metro. Transform just this real module
// for the test runtime, retaining its asynchronous import/observer boundaries.
const filename = require.resolve('../savedLocalMemories');
const transformed = transformSync(readFileSync(filename, 'utf8'), {
  filename,
  babelrc: false,
  configFile: false,
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    require.resolve('@babel/plugin-transform-dynamic-import', {
      paths: [require.resolve('@babel/preset-env')],
    }),
  ],
});
const loaded = { exports: {} };
const dependencies = {
  './savedMemoryReadDiagnostics': () =>
    require('../savedMemoryReadDiagnostics'),
  '@orot/agent-memory': () => require('@orot/agent-memory'),
  '../storage/agentMemoryStorage': () =>
    require('../../storage/agentMemoryStorage'),
  '../storage/secureDatabase': () => require('../../storage/secureDatabase'),
};
runInNewContext(transformed.code, {
  module: loaded,
  exports: loaded.exports,
  require: name => dependencies[name]?.() ?? require(name),
});
const { loadSavedLocalMemories } = loaded.exports;
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { listSavedMemories } from '@orot/agent-memory';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../storage/agentMemoryStorage', () => ({
  SqlCipherAgentMemoryStorage: jest.fn(),
}));
jest.mock('@orot/agent-memory', () => ({ listSavedMemories: jest.fn() }));

beforeEach(() => jest.clearAllMocks());
const report = jest.mocked(providerDiagnostic);
const secretError = new Error(
  'synthetic private payload must not enter diagnostics',
);

test.each(['saved_memory_modules', 'saved_memory_open', 'saved_memory_read'])(
  'reports only fixed %s failure tokens and preserves the exact error',
  async stage => {
    await expect(
      observeSavedMemoryRead(stage, async () => {
        throw secretError;
      }),
    ).rejects.toBe(secretError);
    expect(report.mock.calls).toEqual([
      ['storage', stage, 'started'],
      ['storage', stage, 'failed'],
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      secretError.message,
    );
  },
);

test('broken diagnostic sink cannot change success or failure', async () => {
  report.mockImplementation(() => {
    throw new Error('sink failed');
  });
  const value = [{ text: 'synthetic private record' }];
  await expect(
    observeSavedMemoryRead('saved_memory_read', async () => value),
  ).resolves.toBe(value);
  await expect(
    observeSavedMemoryRead('saved_memory_open', async () => {
      throw secretError;
    }),
  ).rejects.toBe(secretError);
  report.mockReset();
});

test('an open failure is not turned into empty records or an inferred locked state', async () => {
  jest.mocked(openLocalAgentMemoryDatabase).mockRejectedValueOnce(secretError);
  await expect(loadSavedLocalMemories()).rejects.toBe(secretError);
  expect(listSavedMemories).not.toHaveBeenCalled();
  expect(report.mock.calls).toEqual([
    ['storage', 'saved_memory_modules', 'started'],
    ['storage', 'saved_memory_modules', 'completed'],
    ['storage', 'saved_memory_open', 'started'],
    ['storage', 'saved_memory_open', 'failed'],
  ]);
});

test('enumeration failure stays distinct from successful empty records', async () => {
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({});
  jest
    .mocked(listSavedMemories)
    .mockRejectedValueOnce(secretError)
    .mockResolvedValueOnce([]);
  await expect(loadSavedLocalMemories()).rejects.toBe(secretError);
  expect(report.mock.calls.at(-1)).toEqual([
    'storage',
    'saved_memory_read',
    'failed',
  ]);
  await expect(loadSavedLocalMemories()).resolves.toEqual([]);
  expect(report.mock.calls.at(-1)).toEqual([
    'storage',
    'saved_memory_read',
    'completed',
  ]);
  expect(JSON.stringify(report.mock.calls)).not.toContain(secretError.message);
});
