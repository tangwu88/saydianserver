#!/usr/bin/env python3
"""Host-side pre-pull gate. Does not start containers or print environment data."""
import json
import os
import re
import sys
import subprocess


def capacity(manifest, state, revision, free_bytes, application_bytes=None, infrastructure_bytes=None):
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or manifest.get("revision") != revision or manifest.get("schemaVersion") != 1:
        raise ValueError("Release revision mismatch")
    if state.get("schemaVersion") != 1 or state.get("site") != "us" or state.get("host") != "47.85.43.52":
        raise ValueError("Unexpected US target")
    if set(manifest.get("images", {})) != {"api", "worker", "admin"}:
        raise ValueError("Expected all three verified application images")
    total = 5 * 1024 ** 3
    for name, image in manifest["images"].items():
        if not re.fullmatch(r"ghcr.io/tangwu88/saydianserver-" + name + r"@sha256:[a-f0-9]{64}", image.get("ref", "")):
            raise ValueError("Immutable image required")
        value = image.get("sizeBytes")
        if type(value) is not int or value <= 0:
            raise ValueError("Image measurement missing")
        if application_bytes is None:total += value
    if application_bytes is not None:
        if type(application_bytes) is not int or application_bytes<0:raise ValueError('Invalid incremental image measurement')
        total+=application_bytes
    for key in ["infrastructureImageBytes", "databaseBytes", "fileBytes", "backupBytes", "restoreBytes", "transferBytes", "logBytes", "previousReleaseBytes"]:
        value = state.get(key)
        if type(value) is not int or value < 0 or key in {"databaseBytes", "backupBytes", "restoreBytes", "logBytes"} and value == 0:
            raise ValueError("Missing measured " + key)
        if key=='infrastructureImageBytes' and infrastructure_bytes is not None:
            if type(infrastructure_bytes) is not int or not 0<=infrastructure_bytes<=value:raise ValueError('Invalid infrastructure measurement')
            value=infrastructure_bytes
        total += value
    return {"requiredBytes": total, "freeBytes": free_bytes, "missingBytes": max(0, total-free_bytes), "permitted": free_bytes >= total}


def incremental_images(manifest, inspect, cached_layers):
    total=0
    seen=set()
    for image in manifest['images'].values():
        actual=inspect(image['ref'])
        if actual and image['ref'] in actual.get('RepoDigests',[]):
            total+=1024**2  # New config/manifest metadata allowance.
            continue
        layers=image.get('layers')
        if not layers:
            total+=image['sizeBytes']  # Older CI manifests retain the conservative full-image gate.
            continue
        assert isinstance(layers,list) and layers
        for layer in layers:
            diff=layer.get('diffId');size=layer.get('uncompressedBytes')
            assert re.fullmatch(r'sha256:[a-f0-9]{64}',diff or '') and type(size) is int and size>0
            if diff not in cached_layers and diff not in seen:
                total+=(size*6+4)//5+16*1024**2  # Unpack/filesystem overhead, plus transfer budget below.
            seen.add(diff)
        total+=1024**2
    return total


def docker_inspect(ref):
    result=subprocess.run(['docker','image','inspect',ref],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    return json.loads(result.stdout)[0] if result.returncode==0 else None


def host_incremental(manifest,state,directory):
    ids=subprocess.check_output(['docker','image','ls','--no-trunc','--quiet']).decode().splitlines()
    cached=set()
    for image_id in set(ids):
        image=docker_inspect(image_id)
        # On this host classic overlay2 materializes pulled layers. Do not assume lazy snapshots are unpacked.
        if image and image.get('GraphDriver',{}).get('Name')=='overlay2':cached.update(image.get('RootFS',{}).get('Layers',[]))
    infrastructure_bytes=state['infrastructureImageBytes']
    proof=os.path.join(directory,'private','bootstrap-image-proof.json')
    if os.path.isfile(proof):
        items=json.load(open(proof))
        entries=[items.get(name,{}) for name in ['minio','mc','postgres:16-alpine','redis:7.2-alpine']]
        if all(item.get('ref') and (docker_inspect(item['ref']) or {}).get('RepoDigests') and item['ref'] in docker_inspect(item['ref'])['RepoDigests'] for item in entries):
            infrastructure_bytes=0
    return incremental_images(manifest,docker_inspect,cached),infrastructure_bytes


if __name__ == "__main__":
    revision, manifest_file, state_file, directory = sys.argv[1:]
    fs = os.statvfs(directory)
    manifest,state=json.load(open(manifest_file)),json.load(open(state_file))
    app_bytes,infra_bytes=host_incremental(manifest,state,directory)
    report = capacity(manifest,state,revision,fs.f_bavail*fs.f_frsize,app_bytes,infra_bytes)
    report.update(incrementalApplicationBytes=app_bytes,incrementalInfrastructureBytes=infra_bytes)
    print(json.dumps(report))
    sys.exit(0 if report["permitted"] else 2)
