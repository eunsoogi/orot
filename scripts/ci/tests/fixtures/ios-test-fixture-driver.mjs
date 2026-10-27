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
  selectedIdentifiers,
  profile = 'fixtures',
  invalidRequest,
  cancelAfterComplete = false,
  replayToken = false,
  reverse = false,
  qualifiedName = false,
} = {}) {
  const repository = process.cwd();
  const value = createProductFixture(profile);
  const spec = iosTestConfig(profile);
  const owner = {
    ...spec,
    name: 'owned-continuation-fixture',
    udid: '11111111-2222-4333-8444-555555555555',
  };
  // Exercise established calendar cases regardless of new full-reset cases in the inventory.
  const calendarCases = iosTestInventory('fixtures', 'calendar');
  const identifiers =
    selectedIdentifiers ??
    (scoped
      ? calendarCases.filter((identifier) =>
          /\/(AppointmentsUITests|CalendarSelectionUITests|ScheduleCalendarUITests)\//.test(
            identifier,
          ),
        )
      : [
          ...iosTestInventory('fixtures').filter((identifier) =>
            identifier.includes('/StorageMigrationUITests/'),
          ),
          calendarCases.find((identifier) => identifier.includes('/CalendarSelectionUITests/')),
        ]);
  const trace = join(value.root, 'calls.jsonl');
  const cleanupMarker = join(value.root, 'fixture-cleanup-completed');
  writeFileSync(trace, '');
  const installed = join(value.root, 'installed.flag');
  const container = join(value.root, 'data');
  mkdirSync(container);
  const ownerFile = join(value.root, 'owner.json');
  writeFileSync(ownerFile, JSON.stringify(owner));
  const output = join(value.root, 'results');
  const program = `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);const name=path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({name,args})+'\\n');
const caseEntered=fs.readFileSync(${JSON.stringify(trace)},'utf8').trim().split('\\n').map(JSON.parse).some(x=>x.name==='xcrun'&&x.args[1]==='launch');
if(name==='xcrun'&&args[0]==='simctl'&&args[1]===${JSON.stringify(setupFailure)}&&(args[1]!=='get_app_container'||args[3]==='com.orot.mobile')&&(!${afterFirstCase}||caseEntered)){console.error('original-'+args[1]+'-setup-failure');process.exit(9);}
if(name==='xcodebuild'){
 (async()=>{
 const selected=args.filter(x=>x.startsWith('-only-testing:')).map(x=>x.slice(14));
 const result=args[args.indexOf('-resultBundlePath')+1]; fs.mkdirSync(result);
 const session=process.env.TEST_RUNNER_OROT_IOS_FIXTURE_SESSION;
 let previousToken;
  const request=(stage,identifier,passed)=>new Promise((resolve,reject)=>{const token=${replayToken}&&stage==='complete'?previousToken:require('node:crypto').randomUUID();previousToken=token;const [target,cls,method]=identifier.split('/');let input='';const socket=require('node:net').connect(Number(process.env.TEST_RUNNER_OROT_IOS_FIXTURE_PORT),'127.0.0.1',()=>socket.write(JSON.stringify({session,token,name:'-['+(${qualifiedName}?target+'.':'')+cls+' '+method+']',stage:${JSON.stringify(invalidRequest)}&&stage==='prepare'?'unexpected':stage,passed})+'\\n'));socket.on('data',x=>input+=x);socket.on('error',reject);socket.on('end',()=>{try{resolve(JSON.parse(input).ok);}catch(error){reject(error);}});});
 let failed=false;const observations=[];
 for(const identifier of (${reverse}?selected.slice().reverse():selected)){
  if(failed){observations.push({identifier,result:'Skipped'});continue;}
  const ready=!session||await request('prepare',identifier);
  const passed=ready&&!(${failFirst}&&identifier===${JSON.stringify(identifiers[0])});
  observations.push({identifier,result:passed?'Passed':'Failed'});
  const clean=!session||await request('complete',identifier,passed);
  if(session&&clean){fs.writeFileSync(${JSON.stringify(cleanupMarker)},'done');await new Promise(resolve=>setTimeout(resolve,30));}
  failed=!passed||!clean;
 }
 fs.writeFileSync(path.join(result,'observations.json'),JSON.stringify(observations));
 if(${cancelAfterComplete}&&!failed){process.on('SIGTERM',()=>process.exit(0));process.kill(Number(process.env.FIXTURE_DRIVER_PID),'SIGTERM');setInterval(()=>{},1000);return;}
 process.exit(failed?65:0);
 })().catch(error=>{console.error(error);process.exit(65);});return;
}
if(name!=='xcrun'){console.log('synthetic resource sample');process.exit(0);}
if(args[0]==='simctl'&&args[1]==='spawn'&&args[4]==='stream'){
 process.stdout.write('Filtering the log data using (fixture)\\nTimestamp               Ty Process[PID:TID]\\n');
 const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(cleanupMarker)})){process.stdout.write('FIXTURE_CLEANUP_COMPLETED\\n');}},2);
 process.on('SIGTERM',()=>{clearInterval(timer);process.exit(143);});return;
}
if(args[0]==='xcresulttool'){
 if(args[1]==='export'){fs.mkdirSync(args[args.indexOf('--output-path')+1],{recursive:true});process.exit(0);}
 const result=args[args.indexOf('--path')+1];const observations=JSON.parse(fs.readFileSync(path.join(result,'observations.json'),'utf8'));
 console.log(JSON.stringify({testNodes:[{nodeType:'UI test bundle',name:'OrotUITests',children:observations.map(x=>({nodeType:'Test Case',nodeIdentifier:x.identifier.split('/').slice(1).join('/')+'()',result:x.result}))}]}));process.exit(0);
}
if(args[1]==='list'&&args[2]==='-j'){console.log(JSON.stringify({runtimes:[{identifier:${JSON.stringify(spec.runtime)},buildversion:${JSON.stringify(spec.runtimeBuild)},isAvailable:true}],devices:{[${JSON.stringify(spec.runtime)}]:[{udid:${JSON.stringify(owner.udid)},name:${JSON.stringify(owner.name)},deviceTypeIdentifier:${JSON.stringify(spec.device)},state:'Booted'}]}}));process.exit(0);}
if(args[1]==='get_app_container'){if(args[3].endsWith('.xctrunner')||fs.existsSync(${JSON.stringify(installed)})){console.log(${JSON.stringify(container)});process.exit(0);}console.error('domain=NSPOSIXErrorDomain, code=2');process.exit(2);}
if(args[1]==='install')fs.writeFileSync(${JSON.stringify(installed)},'installed');
if(args[1]==='uninstall'&&!${cleanupFailure})fs.rmSync(${JSON.stringify(installed)});
if(args[1]==='launch'){
 const token=args.at(-1), action=args.at(-2), folder=path.join(${JSON.stringify(container)},'Library/Caches/OrotFixtureReceipts');fs.mkdirSync(folder,{recursive:true});
 const launches=fs.readFileSync(${JSON.stringify(trace)},'utf8').trim().split('\\n').map(JSON.parse).filter(x=>x.args[1]==='launch').length;
 const paths=Object.fromEntries(['database','wal','shm','recordings','deletions','exports'].map(x=>[x,false]));
 const keys=Object.fromEntries(['com.orot.mobile.database-encryption-key.v1','com.orot.mobile.database-initialization.v1','com.orot.mobile.provider-selection.v1','com.orot.provider.openai.credentials','com.orot.provider.openai.simulator-fixture'].map(x=>[x,false]));
 if(${cleanupFailure}&&launches>1)paths.recordings=true;
 fs.writeFileSync(path.join(folder,token+'-'+action+'.json'),JSON.stringify({token,action,ok:true,processIdentifier:process.pid,state:{paths,keys,keyFingerprint:null,preferencesEmpty:true,preferences:{OrotFixturePollution:false,'com.orot.provider.openai.ext-agent-host-id':false},pollutedPreferencesAbsent:true,microphoneUndetermined:true,speechUndetermined:true}}));
 console.log('com.orot.mobile: '+process.pid);
}
console.log('synthetic owned fixture operation');
`;
  for (const name of ['xcrun', 'xcodebuild', 'ps', 'vm_stat', 'sysctl'])
    writeFileSync(join(value.root, 'bin', name), program, { mode: 0o755 });
  mkdirSync(join(value.products, spec.configuration + '-iphonesimulator', 'Orot.app'), {
    recursive: true,
  });
  writeFileSync(
    join(
      value.products,
      spec.configuration + '-iphonesimulator',
      'OrotUITests-Runner.app',
      'Info.plist',
    ),
    JSON.stringify({ CFBundleIdentifier: 'com.orot.mobile.OrotUITests.xctrunner' }),
  );
  const driverArgs = [
    resolve(repository, 'scripts/ci/run-ios-fixture-tests.mjs'),
    profile,
    join(value.products, 'OrotTests_iphonesimulator27.1-arm64.xctestrun'),
    ownerFile,
    output,
    ...identifiers,
  ];
  const bootstrap = `process.env.FIXTURE_DRIVER_PID=String(process.pid);process.argv=${JSON.stringify([process.execPath, ...driverArgs])};await import(${JSON.stringify(driverArgs[0])});`;
  const outcome = spawnSync(process.execPath, ['--input-type=module', '-e', bootstrap], {
    cwd: repository,
    env: value.env,
    encoding: 'utf8',
  });
  const recordedCalls = readFileSync(trace, 'utf8').trim();
  const calls = recordedCalls ? recordedCalls.split('\n').map(JSON.parse) : [];
  return {
    ...value,
    outcome,
    calls,
    identifiers,
    output,
    report: () => JSON.parse(readFileSync(join(output, 'results.json'), 'utf8')),
  };
}
