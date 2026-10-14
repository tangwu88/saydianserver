#!/usr/bin/env python3
"""Initialize only the independent fresh US system with CI-verified images.

No China database access, build, arbitrary destination or member seed exists here.
Python 3.6 compatible for the approved Virginia host. Fail closed; never erase data.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from capacity import capacity

ROOT = Path('/opt/saydian-us')
if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('US_BOOTSTRAP_CI_ROOT','').startswith('/tmp/saydian-us-ci-'):
    ROOT = Path(os.environ['US_BOOTSTRAP_CI_ROOT'])


def run(args, data=None, env=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        # Docker/Prisma errors can contain connection credentials. Keep diagnostics private.
        with (ROOT/'private/bootstrap-error.log').open('ab') as output:
            output.write(result.stdout+result.stderr)
        raise RuntimeError('US bootstrap operation failed; see root-only bootstrap-error.log')
    return result.stdout


def write_json(path, value):
    temp = Path(str(path)+'.next')
    with temp.open('w') as file:
        json.dump(value,file,indent=2)
        file.flush()
        os.fsync(file.fileno())
    temp.replace(path)


def infrastructure(manifest):
    assert manifest.get('schemaVersion') == 1 and manifest.get('site') == 'us'
    assert re.fullmatch(r'[a-f0-9]{40}',manifest.get('revision',''))
    assert set(manifest.get('images',{})) == {'minio','mc'}
    sources={'minio':'72cff79c8a7cc59bccb591995e3c3ed6aa2f4cd5','mc':'2c94b8d03979ed96a6379ecabc3435b271398efc'}
    for name,image in manifest['images'].items():
        assert re.fullmatch(r'ghcr.io/tangwu88/saydianserver-us-'+name+r'@sha256:[a-f0-9]{64}',image.get('ref',''))
        assert image.get('sourceRevision') == sources[name]
        assert image.get('imageId') == image['ref'].split('@')[1]
        assert type(image.get('sizeBytes')) is int and image['sizeBytes'] > 0
    return sum(image['sizeBytes'] for image in manifest['images'].values())


def main():
    os.umask(0o077)
    assert os.geteuid() == 0
    source = Path(os.environ['RELEASE_SOURCE'])
    assert str(source).startswith(str(ROOT/'releases/ci-')) and source.is_dir()
    revision=os.environ['RELEASE_SHA']
    private=ROOT/'private'
    assert private.is_dir() and (private/'runtime.env').is_file()
    assert not (private/'accepted-state.json').exists(), 'Already initialized; use ordinary release'
    manifest=json.loads((source/'deploy/release-manifest.json').read_text())
    storage=json.loads((source/'deploy/us/storage-manifest.json').read_text())
    storage_bytes=infrastructure(storage)
    # Fresh-database conservative ceilings, not measurements of historical users.
    state={'schemaVersion':1,'host':'47.85.43.52','site':'us',
           'dataMode':'fresh-independent','infrastructureImageBytes':storage_bytes+256*1024**2,
           'databaseBytes':128*1024**2,'fileBytes':16*1024**2,'backupBytes':32*1024**2,
           'restoreBytes':128*1024**2,'transferBytes':256*1024**2,'logBytes':60*1024**2,'previousReleaseBytes':0}
    fs=os.statvfs(str(ROOT))
    report=capacity(manifest,state,revision,fs.f_bavail*fs.f_frsize)
    print(json.dumps(report),flush=True)
    assert report['permitted'], '5GiB capacity gate failed before pulling'
    marker=private/'bootstrap-in-progress.json'
    if marker.exists():
        assert json.loads(marker.read_text())['revision'] == revision, 'Resume same verified revision only'
    else:
        containers=run(['docker','ps','-aq','--filter','label=com.docker.compose.project=saydian-us']).strip()
        assert not containers, 'Fresh bootstrap refuses an existing US system'
        for name in ['us_postgres','us_redis','us_files']:
            assert not run(['docker','volume','ls','-q','--filter','name=^saydian-us_'+name+'$']).strip(), 'Existing US volume requires recovery review'
        write_json(marker,{'revision':revision,'storageRevision':storage['revision']})
    image_file=source/'deploy/us/images.env'
    with image_file.open('w') as file:
        file.write('US_REVISION='+revision+'\n')
        for name,image in manifest['images'].items():file.write('US_'+name.upper()+'_IMAGE='+image['ref']+'\n')
        for name,image in storage['images'].items():file.write('US_'+name.upper()+'_IMAGE='+image['ref']+'\n')
    with (private/'infrastructure.env').open('w') as file:
        for name,image in storage['images'].items():file.write('US_'+name.upper()+'_IMAGE='+image['ref']+'\n')
    compose=['docker','compose','--project-name','saydian-us','--env-file',str(private/'runtime.env'),
             '--env-file',str(image_file),'-f',str(source/'deploy/us/compose.json')]
    run(compose+['config','--quiet'])
    run(compose+['--profile','bootstrap','pull'])
    observed_images={}
    for name,image in dict(manifest['images'],**storage['images']).items():
        actual=json.loads(run(['docker','image','inspect',image['ref']]))[0]
        # Classic overlay2 reports config Id; CI containerd reports manifest Id.
        # The immutable RepoDigest is the portable identity on both backends.
        assert image['ref'] in actual.get('RepoDigests',[]), 'Pulled immutable manifest differs'
        assert actual['Os'] == 'linux' and actual['Architecture'] == 'amd64'
        observed_images[name]={'ref':image['ref'],'sizeBytes':actual['Size']}
        expected=storage['revision'] if name in storage['images'] else revision
        assert actual['Config']['Labels']['org.opencontainers.image.revision'] == expected
    for name in ['postgres:16-alpine','redis:7.2-alpine']:
        actual=json.loads(run(['docker','image','inspect',name]))[0]
        observed_images[name]={'ref':actual['RepoDigests'][0],'sizeBytes':actual['Size']}
    write_json(private/'bootstrap-image-proof.json',observed_images)
    fs=os.statvfs(str(ROOT))
    outstanding=sum(state[key] for key in ['databaseBytes','fileBytes','backupBytes','restoreBytes','logBytes'])
    assert fs.f_bavail*fs.f_frsize >= 5*1024**3+outstanding, 'Post-pull reserve and data/backup/restore allowance breached'
    run(compose+['up','-d','--wait','--wait-timeout','180','us-postgres','us-redis','us-minio'])
    run(compose+['--profile','bootstrap','run','--rm','-T','--no-deps','us-minio-init'])
    values={}
    for line in (private/'runtime.env').read_text().splitlines():
        if line and not line.startswith('#'):
            key,value=line.split('=',1);values[key]=value
    assert re.fullmatch(r'[a-f0-9]{64}',values['US_OWNER_PASSWORD'])
    assert re.fullmatch(r'[a-f0-9]{64}',values['US_DATABASE_PASSWORD'])
    environment=dict(os.environ)
    environment['DATABASE_URL']='postgresql://us_owner:'+values['US_OWNER_PASSWORD']+'@us-postgres:5432/saydian_us?schema=public&connection_limit=2'
    # An empty destination can execute the complete SQL history already exercised by CI.
    run(compose+['run','--rm','-T','--no-deps','-e','DATABASE_URL','us-api','./node_modules/.bin/prisma','migrate','deploy'],env=environment)
    pg=['docker','exec','-i','saydian-us-us-postgres-1','psql','-X','-v','ON_ERROR_STOP=1','-U','us_owner','-d','saydian_us','-At']
    assert run(pg+['-c','SELECT count(*) FROM "User"']).strip() == b'0', 'Existing members require independent review'
    sql="""DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='us_app') THEN CREATE ROLE us_app LOGIN; END IF; END $$;
ALTER ROLE us_app PASSWORD '%s';
REVOKE ALL ON DATABASE saydian_us FROM PUBLIC;
GRANT CONNECT ON DATABASE saydian_us TO us_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO us_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO us_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO us_app;
ALTER DEFAULT PRIVILEGES FOR ROLE us_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO us_app;
ALTER DEFAULT PRIVILEGES FOR ROLE us_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO us_app;
""" % values['US_DATABASE_PASSWORD']
    run(pg,sql.encode())
    run(['docker','run','--rm','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','--network','saydian-us_us_private','--memory','192m','--read-only',
         '--tmpfs','/tmp:size=16m','--env-file',str(private/'runtime.env'),'-e','DATABASE_URL',
         '-v',str(source)+':/release:ro','--entrypoint','node',manifest['images']['api']['ref'],
         '/release/deploy/us/bootstrap-seed.cjs'],env=environment)
    history=run(pg+['-c','SELECT coalesce(json_agg(t),\'[]\'::json)::text FROM (SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations") t'])
    (source/'history.json').write_bytes(history)
    run(['docker','run','--rm','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','--network','none','--memory','128m','--read-only','-v',str(source)+':/release:ro',
         '--entrypoint','node',manifest['images']['api']['ref'],'--input-type=module','-e',
         "import {readFileSync} from 'node:fs'; import {validateManifest,verifyMigrationHistory} from '/release/deploy/scripts/release-manifest.mjs'; const m=validateManifest(JSON.parse(readFileSync('/release/deploy/release-manifest.json')),process.argv[1]); if(verifyMigrationHistory(m,JSON.parse(readFileSync('/release/history.json'))).length) throw Error('Incomplete schema');",revision])
    # Real host dump and restore into a different database; compare every table, including row contents.
    dump=private/'bootstrap-backup.dump'
    dump.write_bytes(run(['docker','exec','saydian-us-us-postgres-1','pg_dump','-U','us_owner','-d','saydian_us','-Fc']))
    run(pg+['-c','DROP DATABASE IF EXISTS saydian_us_restore_check'])
    run(pg+['-c','CREATE DATABASE saydian_us_restore_check'])
    run(['docker','exec','-i','saydian-us-us-postgres-1','pg_restore','-U','us_owner','-d','saydian_us_restore_check','--no-owner','--no-privileges','--exit-on-error'],dump.read_bytes())
    tables=run(pg+['-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]).decode().splitlines()
    summary=[]
    restorepg=pg[:];restorepg[restorepg.index('saydian_us')]='saydian_us_restore_check'
    for table in tables:
        identifier='"'+table.replace('"','""')+'"'
        query='SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY md5(to_jsonb(t)::text)),\'\')) FROM '+identifier+' t'
        before=run(pg+['-c',query]);after=run(restorepg+['-c',query])
        assert before == after, 'Restored table differs: '+table
        summary.append({'table':table,'countAndDigest':before.decode().strip()})
    write_json(private/'bootstrap-restore-proof.json',{'revision':revision,'tables':summary,'backupSha256':hashlib.sha256(dump.read_bytes()).hexdigest()})
    run(pg+['-c','DROP DATABASE saydian_us_restore_check'])
    # Test the application's restricted S3 credentials and anonymous denial using the real private service.
    probe='''mc alias set app http://us-minio:9000 "$BUCKET_ACCESS_KEY" "$BUCKET_SECRET_KEY" >/dev/null
printf 'synthetic US private storage acceptance' >/tmp/probe
mc cp /tmp/probe app/saydian-us-private/bootstrap-probe >/dev/null
mc cat app/saydian-us-private/bootstrap-probe | cmp /tmp/probe -
wget -S -O /dev/null http://us-minio:9000/saydian-us-private/bootstrap-probe 2>/tmp/denied || true
grep -q 403 /tmp/denied
mc rm app/saydian-us-private/bootstrap-probe >/dev/null
'''
    run(compose+['--profile','bootstrap','run','--rm','-T','--no-deps','us-minio-init',probe])
    run(compose+['up','-d','--wait','--wait-timeout','180','us-api','us-worker','us-admin'])
    health=json.loads(run(['curl','--fail','--silent','--max-time','15','http://127.0.0.1:18180/health/ready']))
    assert health['revision'] == revision
    for cid in run(compose+['ps','-q']).decode().splitlines():
        item=json.loads(run(['docker','inspect',cid]))[0]
        assert item['State']['Running'] and not item['State']['OOMKilled'] and item['RestartCount'] == 0
    state.update(restoreAccepted=True,accountSelectionAccepted=True,filesVerified=True,storageRevision=storage['revision'],
                 publicAcceptance=False,measurementNote='Fresh system conservative ceilings; restore proof records real rows and digests')
    state['actualDatabaseBytes']=int(run(pg+['-c',"SELECT pg_database_size('saydian_us')"]).strip())
    state['actualBackupBytes']=dump.stat().st_size
    state['infrastructureImageBytes']=sum(observed_images[name]['sizeBytes'] for name in ['minio','mc','postgres:16-alpine','redis:7.2-alpine'])
    assert os.statvfs(str(ROOT)).f_bavail*os.statvfs(str(ROOT)).f_frsize >= 5*1024**3
    write_json(private/'accepted-state.json',state)
    (ROOT/'current').symlink_to(source)
    (ROOT/'deployed-revision').write_text(revision+'\n')
    print('Fresh US system initialized in maintenance; real backup/restore, exact images, private S3 and local health accepted',flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
