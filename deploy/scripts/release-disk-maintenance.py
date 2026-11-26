#!/usr/bin/env python3
"""One-off release recovery: inspect, or remove explicitly reviewed old images only."""
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = '/opt/saydianapp-server'
REPOS = {'ghcr.io/tangwu88/saydianserver-' + name for name in ('api', 'worker', 'admin')}
IDENTITY = re.compile(r'^sha256:[a-f0-9]{64}$')


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def inspect():
    containers = docker('ps', '-aq').split()
    used = set(docker('inspect', '--format', '{{.Image}}', *containers).split()) if containers else set()
    rows = [json.loads(line) for line in docker('image', 'ls', '--no-trunc', '--format', '{{json .}}').splitlines()]
    ids = sorted({row['ID'] for row in rows if row['Repository'] in REPOS})
    template = '{"id":{{json .Id}},"created":{{json .Created}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}},"size":{{json .Size}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
    images = [json.loads(line) for line in docker('image', 'inspect', '--format', template, *ids).splitlines()] if ids else []
    return {'used': sorted(used), 'images': images}


def eligible(snapshot, now):
    used = set(snapshot['used'])
    groups = {repo: [] for repo in REPOS}
    for image in snapshot['images']:
        refs = [ref.rsplit(':', 1)[0] for ref in image.get('tags') or []]
        refs += [ref.split('@')[0] for ref in image.get('digests') or []]
        if not refs or not set(refs).issubset(REPOS) or len(set(refs)) != 1 or image['id'] in used:
            continue
        groups[refs[0]].append(image)
    result = []
    for rows in groups.values():
        # Keep the two newest unreferenced images per component in addition to ALL
        # running/stopped container references, and never remove a recent image.
        rows.sort(key=lambda item: item['created'], reverse=True)
        for image in rows[2:]:
            created = datetime.datetime.fromisoformat(image['created'].replace('Z', '+00:00'))
            if created <= now - datetime.timedelta(days=7):
                result.append(image)
    return sorted(result, key=lambda item: (item['created'], item['id']))


def maintain(plan, snapshot=inspect, remove=None, free=None, now=None):
    if plan.get('action') not in ('audit', 'cleanup'):
        raise ValueError('Only audit or explicit cleanup is allowed')
    now = now or datetime.datetime.now(datetime.timezone.utc)
    free = free or (lambda: shutil.disk_usage(ROOT).free)
    remove = remove or (lambda image_id: subprocess.run(['docker', 'image', 'rm', image_id], check=True, stdout=subprocess.DEVNULL))
    initial = snapshot()
    candidates = eligible(initial, now)
    result = {'action': plan['action'], 'freeBytesBefore': free(), 'referencedImageCount': len(initial['used']), 'eligible': candidates, 'removed': []}
    if plan['action'] == 'cleanup':
        selected = plan.get('images')
        target = plan.get('targetFreeBytes')
        if not isinstance(selected, list) or not 1 <= len(selected) <= 9 or len(set(selected)) != len(selected) or not all(isinstance(value, str) and IDENTITY.fullmatch(value) for value in selected):
            raise ValueError('Cleanup requires 1 to 9 unique full image IDs')
        if not isinstance(target, int) or not 7 * 1024**3 <= target <= 12 * 1024**3:
            raise ValueError('Free-space target outside recovery bounds')
        if not set(selected).issubset({image['id'] for image in candidates}):
            raise ValueError('An image is referenced, recent, protected, or outside this project')
        for image_id in selected:
            if free() >= target:
                break
            if image_id not in {image['id'] for image in eligible(snapshot(), now)}:
                raise ValueError('Image references or retention changed; stopped before removal')
            # No force, container deletion, pruning, volume operation or file deletion.
            remove(image_id)
            result['removed'].append(image_id)
    result['freeBytesAfter'] = free()
    return result


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Root receiver required')
    with open(sys.argv[1], encoding='utf-8') as stream:
        plan = json.load(stream)
    revision = os.environ.get('RELEASE_SHA', '')
    if not re.fullmatch('[a-f0-9]{40}', revision) or plan.get('revision') != revision:
        raise SystemExit('Release identity mismatch')
    running = docker('inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', 'saydian-global-global-api-1')
    if running != plan.get('runningRevision'):
        raise SystemExit('Runtime changed; no cleanup performed')
    print(json.dumps(maintain(plan), ensure_ascii=False))
