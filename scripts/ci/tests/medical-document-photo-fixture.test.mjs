import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, rmSync } from 'node:fs';
import { fixture } from './fixtures/ios-test-runner.mjs';
import {
  photoDocumentJourney,
  prepareMedicalDocumentPhoto,
} from '../medical-document-photo-fixture.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('seeds only the selected photo journey after verifying the owned booted destination', () => {
  const owner = { udid: 'synthetic-device' };
  const calls = [];
  const verify = (observed, profile) => {
    assert.equal(observed, owner);
    assert.equal(profile, 'fixtures');
    calls.push('verified');
    return { state: 'Booted' };
  };
  const run = (args) => {
    assert.deepEqual(args.slice(0, 2), ['addmedia', owner.udid]);
    assert.ok(existsSync(args[2]));
    calls.push('seeded');
  };
  prepareMedicalDocumentPhoto('fixtures', owner, 'unrelated', verify, run);
  assert.deepEqual(calls, []);
  prepareMedicalDocumentPhoto('fixtures', owner, photoDocumentJourney, verify, run);
  assert.deepEqual(calls, ['verified', 'seeded']);
  assert.throws(() =>
    prepareMedicalDocumentPhoto(
      'fixtures',
      owner,
      photoDocumentJourney,
      () => ({ state: 'Shutdown' }),
      run,
    ),
  );
  assert.deepEqual(calls, ['verified', 'seeded']);
});

test('seeds the explicit Duo photo acceptance journey on its owned destination', () => {
  const owner = { udid: 'synthetic-duo-device' };
  const calls = [];
  const verify = (observed, profile) => {
    assert.equal(observed, owner);
    assert.equal(profile, 'duo');
    calls.push('verified');
    return { state: 'Booted' };
  };
  const run = (args) => {
    assert.deepEqual(args.slice(0, 2), ['addmedia', owner.udid]);
    assert.ok(existsSync(args[2]));
    calls.push('seeded');
  };

  prepareMedicalDocumentPhoto('duo', owner, photoDocumentJourney, verify, run);

  assert.deepEqual(calls, ['verified', 'seeded']);
});

test('photo journey is admitted to both real fixture profiles', () => {
  assert.ok(iosTestInventory('fixtures', 'calendar').includes(photoDocumentJourney));
  assert.ok(iosTestInventory('health-import').includes(photoDocumentJourney));
});

test('fixture runner seeds its owned Photos library before the selected photo journey', () => {
  const run = fixture(0, 'fixtures', 'all', [photoDocumentJourney]);
  try {
    assert.equal(run.outcome.status, 0, run.outcome.stderr);
    const seeds = run.calls.filter(
      (call) => call.name === 'xcrun' && call.args[0] === 'simctl' && call.args[1] === 'addmedia',
    );
    const test = run.calls.findIndex((call) => call.name === 'xcodebuild');
    assert.equal(seeds.length, 1);
    assert.ok(test > run.calls.indexOf(seeds[0]));
    assert.equal(seeds[0].args[2], 'fixture-udid');
  } finally {
    rmSync(run.directory, { recursive: true, force: true });
  }
});
