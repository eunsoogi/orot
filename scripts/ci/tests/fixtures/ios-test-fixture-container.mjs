import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { iosTestConfig } from '../../ios-test-config.mjs';

/** Model exact simctl responses and ownership changes; native installation semantics have separate Simulator evidence. */
export function fixture(
  profile,
  {
    preserveKeychain = false,
    statePersistence = false,
    state = 'Booted',
    ownerProfile = profile,
    action = 'reset',
    installed = true,
    containerError = false,
    uninstallError = false,
    retainAppAfterUninstall = false,
    loseOwnershipAfterUninstall = false,
    slowOperation,
    signalOperation,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'orot-fixture-reset-'));
  const spec = iosTestConfig(profile);
  const owner = {
    ...spec,
    profile: ownerProfile,
    name: 'owned-synthetic-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const calls = join(root, 'calls.jsonl');
  const removed = join(root, 'removed.flag');
  const lostOwner = join(root, 'lost-owner.flag');
  const program = `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const name=require('node:path').basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({name,args})+'\\n');
if(args[1]===${JSON.stringify(slowOperation)}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,31000);
if(args[1]===${JSON.stringify(signalOperation)}) {process.kill(process.pid,'SIGTERM');process.exit(90);}
if(name==='plutil')console.log(JSON.stringify(fs.existsSync(${JSON.stringify(removed)})?{}:{'com.orot.mobile':{}}));
else if(args[1]==='list'&&args[2]==='-j')console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:fs.existsSync(${JSON.stringify(lostOwner)})?'foreign-owner':${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:${JSON.stringify(state)}}]}}));
else if(args[1]==='get_app_container'){if(${containerError}){console.error('Synthetic service unavailable');process.exit(1);}if(!${installed}||fs.existsSync(${JSON.stringify(removed)})){console.error('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2): No such file or directory');process.exit(2);}console.log('/synthetic/owned/Orot.app');}
else {if(args[1]==='uninstall'){if(${uninstallError}){console.error('Synthetic uninstall service failure');process.exit(1);}if(!${retainAppAfterUninstall})fs.writeFileSync(${JSON.stringify(removed)},'removed');if(${loseOwnershipAfterUninstall})fs.writeFileSync(${JSON.stringify(lostOwner)},'lost');}if(args[1]==='install'&&fs.existsSync(${JSON.stringify(removed)}))fs.unlinkSync(${JSON.stringify(removed)});console.log('synthetic fixture response');}
`;
  for (const name of ['xcrun', 'plutil']) writeFileSync(join(root, name), program, { mode: 0o755 });
  const app = join(root, 'Orot.app');
  const entry =
    action === 'cleanup' ? 'removeIosTestFixtureContainer' : 'resetIosTestFixtureContainer';
  const code = `import {${entry} as operation} from ${JSON.stringify(pathToFileURL(resolve('scripts/ci/ios-test-fixture-container.mjs')).href)}; const result=operation(${JSON.stringify(profile)},${JSON.stringify(owner)},${JSON.stringify(app)},${JSON.stringify({ preserveKeychain, statePersistence })}); if(result!==undefined)console.log(JSON.stringify(result));`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    env: { ...process.env, PATH: root + ':' + process.env.PATH },
    // This is a test-harness safeguard, not a deadline imposed on a real Simulator operation.
    timeout: 40000,
  });
  return {
    root,
    owner,
    app,
    outcome,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}
