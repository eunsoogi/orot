import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iosTestConfig } from '../../ios-test-config.mjs';
import { iosTestInventory } from '../../ios-test-inventory.mjs';
import { createProductFixture } from '../ios-test-products-fixture.mjs';

// These CLI fixtures reproduce scheduling and ownership; they prove no integration UI acceptance.
export function fixture({
  failFirst = true,
  cleanupFailure = false,
  scoped = false,
  setupFailure,
  afterFirstCase = false,
} = {}) {
  const repository = process.cwd();
  const value = createProductFixture('fixtures');
  const spec = iosTestConfig('fixtures');
  const owner = {
    ...spec,
    name: 'owned-continuation-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  const identifiers = scoped
    ? iosTestInventory('fixtures', 'calendar').slice(-2)
    : [
        ...iosTestInventory('fixtures').filter((identifier) =>
          identifier.includes('/StorageMigrationUITests/'),
        ),
        iosTestInventory('fixtures', 'calendar').at(-1),
      ];
  const trace = join(value.root, 'calls.jsonl');
  const installed = join(value.root, 'installed.flag');
  const container = join(value.root, 'data');
  mkdirSync(container);
  const ownerFile = join(value.root, 'owner.json');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const output = join(value.root, 'results');
  const program = `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);const name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({name,args})+'\\n');
const caseEntered=fs.readFileSync(${JSON.stringify(trace)},'utf8').trim().split('\\n').map(JSON.parse).some(x=>x.name==='xcodebuild');
if(name==='xcrun'&&args[0]==='simctl'&&args[1]===${JSON.stringify(setupFailure)}&&(!${afterFirstCase}||caseEntered)){console.error('original-'+args[1]+'-setup-failure');process.exit(9);}
if(name==='xcodebuild'){
 const identifier=args.find(x=>x.startsWith('-only-testing:')).slice(14);
 const result=args[args.indexOf('-resultBundlePath')+1]; fs.mkdirSync(result); fs.writeFileSync(path.join(result,'identifier'),identifier);
 process.exit(${failFirst}&&identifier===${JSON.stringify(identifiers[0])}?65:0);
}
if(name!=='xcrun'){console.log('synthetic resource sample');process.exit(0);}
if(args[0]==='xcresulttool'){
 if(args[1]==='export'){fs.mkdirSync(args[args.indexOf('--output-path')+1],{recursive:true});process.exit(0);}
 const result=args[args.indexOf('--path')+1];const identifier=fs.readFileSync(path.join(result,'identifier'),'utf8');
 console.log(JSON.stringify({testNodes:[{nodeType:'UI test bundle',name:'OrotUITests',children:[{nodeType:'Test Case',nodeIdentifier:identifier.split('/').slice(1).join('/')+'()',result:'Passed'}]}]}));process.exit(0);
}
if(args[1]==='list'&&args[2]==='-j'){console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));process.exit(0);}
if(args[1]==='get_app_container'){if(fs.existsSync(${JSON.stringify(installed)})){console.log(${JSON.stringify(container)});process.exit(0);}console.error('domain=NSPOSIXErrorDomain, code=2');process.exit(2);}
if(args[1]==='install')fs.writeFileSync(${JSON.stringify(installed)},'installed');
if(args[1]==='uninstall'&&!${cleanupFailure})fs.rmSync(${JSON.stringify(installed)});
if(args[1]==='launch'){
 const token=args.at(-1), action=args.at(-2), folder=path.join(${JSON.stringify(container)},'Library/Caches/OrotFixtureReceipts');fs.mkdirSync(folder,{recursive:true});
 const launches=fs.readFileSync(${JSON.stringify(trace)},'utf8').trim().split('\\n').map(JSON.parse).filter(x=>x.args[1]==='launch').length;
 const paths=Object.fromEntries(['database','wal','shm','recordings','deletions','exports'].map(x=>[x,false]));
 const keys=Object.fromEntries(['com.orot.mobile.database-encryption-key.v1','com.orot.mobile.database-initialization.v1','com.orot.mobile.provider-selection.v1','com.orot.provider.openai.credentials','com.orot.provider.openai.simulator-fixture'].map(x=>[x,false]));
 if(${cleanupFailure}&&launches>1)paths.recordings=true;
 fs.writeFileSync(path.join(folder,token+'-'+action+'.json'),JSON.stringify({token,action,ok:true,processIdentifier:123,state:{paths,keys,keyFingerprint:null,preferencesEmpty:true,pollutedPreferencesAbsent:true,microphoneUndetermined:true,speechUndetermined:true}}));
}
console.log('synthetic owned fixture operation');
`;
  for (const name of ['xcrun', 'xcodebuild', 'ps', 'vm_stat', 'sysctl'])
    writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
  mkdirSync(join(value.products, 'Release-iphonesimulator', 'Orot.app'), { recursive: true });
  const outcome = spawnSync(
    process.execPath,
    [
      resolve(repository, 'scripts/ci/run-ios-fixture-tests.mjs'),
      'fixtures',
      join(value.products, 'OrotTests_iphonesimulator27.0-arm64.xctestrun'),
      ownerFile,
      output,
      ...identifiers,
    ],
    { cwd: repository, env: value.env, encoding: 'utf8' },
  );
  const calls = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  return {
    ...value,
    outcome,
    calls,
    identifiers,
    output,
    report: () => JSON.parse(readFileSync(join(output, 'results.json'), 'utf8')),
  };
}
