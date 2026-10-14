#!/usr/bin/env python3
"""Recoverable archival of a fixed set of unused US legacy code releases."""
import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile

BASE = Path('/www/wwwroot/s.saydian.com-v2/releases')
NAMES = ['20260804T061200Z-8d398d1', '20260804T062700Z-123a518', '20260804T064118Z-8dde9eb',
         '20260804T095228Z-7ae85da', '20260804T095618Z-f95a5b2', '20260804T101900Z-3478455',
         '20260804T104800Z-0271d08', '20260804T105800Z-d2ac279', '20260804T111000Z-e0d6d93',
         '20260804T112000Z-cb5547e', '20260804T-content-v1-details-f80d3a8', '20260804T-video-result-sync-6bda3c6']
ARCHIVE = BASE.parent / 'code-archives'

def hash_stream(stream):
    digest = hashlib.sha256()
    while True:
        chunk = stream.read(1024*1024)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)

def references():
    found = set()
    for pattern in ['/proc/[0-9]*/cwd', '/proc/[0-9]*/exe', '/proc/[0-9]*/fd/*', str(BASE.parent/'*')]:
        for file in glob.glob(pattern):
            try:
                target = os.readlink(file)
                if str(BASE) in target:
                    found.add(target)
            except OSError:
                pass
    for directory in ['/etc/systemd/system', '/usr/lib/systemd/system', '/www/server/panel/vhost/nginx']:
        for path in Path(directory).rglob('*'):
            try:
                if path.is_file() and path.stat().st_size < 1024*1024:
                    text = path.read_text(errors='replace')
                    found.update(re.findall(re.escape(str(BASE))+r'/[^\s\"\';]+', text))
            except OSError:
                pass
    return found

def manifest(directory):
    items = {}
    for root, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs+files:
            path = Path(root)/name
            relative = str(path.relative_to(directory))
            stat = path.lstat()
            if path.is_symlink():
                items[relative] = {'link': os.readlink(path)}
            elif path.is_file():
                with path.open('rb') as stream:
                    items[relative] = {'sha256': hash_stream(stream), 'size': stat.st_size}
            elif path.is_dir():
                items[relative] = {'directory': True}
            else:
                raise ValueError('Special file in code release; stop archive')
    return items

def archive(directory):
    assert directory.parent == BASE and directory.name in NAMES and directory.is_dir() and not directory.is_symlink()
    assert not any(str(directory) in ref for ref in references()), 'Release still referenced'
    before = manifest(directory)
    ARCHIVE.mkdir(mode=0o700, exist_ok=True)
    target = ARCHIVE/(directory.name+'.tar.gz')
    pending = ARCHIVE/(directory.name+'.tar.gz.pending')
    assert not target.exists() and not pending.exists(), 'Existing archive requires review'
    with pending.open('xb') as output:
        os.chmod(pending, 0o600)
        with tarfile.open(fileobj=output, mode='w:gz', compresslevel=6) as tar:
            tar.add(directory, arcname=directory.name, recursive=True)
        output.flush()
        os.fsync(output.fileno())
    verified = {}
    with tarfile.open(pending, 'r:gz') as tar:
        for member in tar:
            parts = Path(member.name).parts
            assert parts[0] == directory.name and '..' not in parts and not member.name.startswith('/')
            relative = '/'.join(parts[1:])
            if not relative:
                continue
            if member.isdir():
                verified[relative] = {'directory': True}
            elif member.issym():
                verified[relative] = {'link': member.linkname}
            elif member.isfile() or member.islnk():
                with tar.extractfile(member) as stream:
                    verified[relative] = {'sha256': hash_stream(stream), 'size': before[relative]['size']}
            else:
                raise ValueError('Unexpected archive member')
    assert verified == before and manifest(directory) == before, 'Archive/source verification failed'
    assert not any(str(directory) in ref for ref in references()), 'Release became active'
    with pending.open('rb') as stream:
        digest = hash_stream(stream)
    pending.rename(target)
    evidence = {'source': str(directory), 'archive': str(target), 'archiveSha256': digest,
                'files': before, 'verified': True, 'restore': 'tar -xzf ARCHIVE -C /www/wwwroot/s.saydian.com-v2/releases'}
    with (ARCHIVE/(directory.name+'.verification.json')).open('x') as output:
        json.dump(evidence, output)
        output.flush()
        os.fsync(output.fileno())
    shutil.rmtree(directory)
    return {'name':directory.name, 'archiveBytes':target.stat().st_size, 'verified':True, 'retainedArchive':str(target)}

if __name__ == '__main__':
    mode = sys.argv[1]
    assert mode in ['plan', 'archive']
    refs = references()
    eligible = [BASE/name for name in NAMES if (BASE/name).is_dir() and not any(str(BASE/name) in ref for ref in refs)]
    if mode == 'plan':
        print(json.dumps({'eligible':[str(p) for p in eligible], 'references':sorted(refs)}))
    else:
        for path in eligible:
            print(json.dumps(archive(path)), flush=True)
        fs=os.statvfs(BASE)
        print(json.dumps({'freeBytes':fs.f_bavail*fs.f_frsize}),flush=True)
