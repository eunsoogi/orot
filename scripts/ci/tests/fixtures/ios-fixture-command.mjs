import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { iosTestConfig } from '../../ios-test-config.mjs';

/** Real host children model completion and failure ordering; no Apple tool or Simulator is invoked. */
export function commandFixture({
  slowPrivacy = false,
  invalidReceipt = false,
  terminateFailure = false,
  loseOwnership = false,
  privacyFailure = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-fixture-command-'));
  const spec = iosTestConfig('fixtures');
  const owner = { ...spec, name: 'owned-command-fixture', udid: 'owned-device' };
  const trace = join(directory, 'calls.jsonl');
  const lost = join(directory, 'lost-owner');
  const paths = ['database', 'wal', 'shm', 'recordings', 'deletions', 'exports'];
  const keys = [
    'com.orot.mobile.database-encryption-key.v1',
    'com.orot.mobile.database-initialization.v1',
    'com.orot.mobile.provider-selection.v1',
    'com.orot.provider.openai.credentials',
    'com.orot.provider.openai.simulator-fixture',
  ];
  const state = {
    paths: Object.fromEntries(paths.map((name) => [name, false])),
    keys: Object.fromEntries(keys.map((name) => [name, false])),
    keyFingerprint: null,
    preferencesEmpty: true,
    preferences: {
      OrotFixturePollution: false,
      'com.orot.provider.openai.ext-agent-host-id': false,
    },
    pollutedPreferencesAbsent: true,
    microphoneUndetermined: true,
    speechUndetermined: true,
  };
  const program = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
if(args[1]==='list')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:fs.existsSync(${JSON.stringify(lost)})?'foreign':${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));
if(args[1]==='get_app_container')console.log(${JSON.stringify(directory)});
if(args[1]==='privacy'){
 if(${slowPrivacy})Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,31000);
 if(${privacyFailure}){console.error('original-privacy-failure');process.exit(7);}
 if(${loseOwnership})fs.writeFileSync(${JSON.stringify(lost)},'lost');
}
if(args[1]==='launch'){
 const action=args.at(-2),token=args.at(-1),folder=path.join(${JSON.stringify(directory)},'Library/Caches/OrotFixtureReceipts');fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,token+'-'+action+'.json'),JSON.stringify({token,action,ok:!${invalidReceipt},processIdentifier:process.pid,state:${JSON.stringify(state)}}));
 console.log('com.orot.mobile: '+process.pid);
}
if(args[1]==='terminate'&&${terminateFailure}){console.error('secondary-terminate-failure');process.exit(8);}
`;
  writeFileSync(join(directory, 'xcrun'), program, { mode: 0o755 });
  const module = pathToFileURL(resolve('scripts/ci/ios-test-scoped-reset.mjs')).href;
  const code = `import {runIosFixtureCommand} from ${JSON.stringify(module)};
try{const result=await runIosFixtureCommand('fixtures',${JSON.stringify(owner)},'reset');console.log(JSON.stringify({passed:true,result}));}
catch(error){console.log(JSON.stringify({passed:false,message:error.message,status:error.status??null,signal:error.signal??null}));process.exitCode=1;}`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    timeout: 45000,
    env: { ...process.env, PATH: directory + ':' + process.env.PATH },
  });
  return {
    directory,
    outcome,
    result: outcome.stdout.trim() ? JSON.parse(outcome.stdout) : null,
    calls: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [],
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}
