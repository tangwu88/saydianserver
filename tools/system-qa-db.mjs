// Wrapper confines the existing opt-in PostgreSQL tests to the exact demo profile.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { validateDemoProfile } from './h5-demo-profile.mjs';
assert.equal(process.env.RUN_SYSTEM_QA,'1');
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),profilePath=process.argv[2];
const profile=parseEnv(await readFile(profilePath,'utf8'));validateDemoProfile(profile,repo,profilePath);
const require=createRequire(join(repo,'apps/api/package.json'));
const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','ComSpec','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATHEXT'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,profile,{RUN_LOCAL_DATABASE_TESTS:'1',WORKER_OUTBOUND_PAUSED:'false',CALLBACK_PROCESSING_PAUSED:'false',NODE_OPTIONS:''});
// Provider objects in these four tests are injected mocks; this starts no API or worker.
const result=spawnSync(process.execPath,['-r',join(repo,'tools/h5-demo-network-guard.cjs'),require.resolve('vitest/vitest.mjs'),'run','src/commerce/commerce-database.test.ts'],{cwd:join(repo,'apps/api'),env,stdio:'inherit',windowsHide:true});
if(result.error)throw new Error('Could not start isolated database tests');
process.exitCode=result.status??1;
