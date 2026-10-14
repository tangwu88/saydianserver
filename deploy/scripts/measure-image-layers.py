#!/usr/bin/env python3
"""CI-only: hash each saved runtime layer and measure its uncompressed tar size."""
import gzip
import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile


def measure(archive):
    opened=tarfile.open(fileobj=archive,mode='r:') if hasattr(archive,'read') else tarfile.open(archive,'r:')
    with opened as tar:
        try:
            manifest=json.load(tar.extractfile('manifest.json'))
            assert len(manifest)==1
            item=manifest[0]
            config=json.load(tar.extractfile(item['Config']))
            paths=item['Layers']
        except KeyError:
            index=json.load(tar.extractfile('index.json'))
            assert len(index['manifests'])==1
            path='blobs/sha256/'+index['manifests'][0]['digest'].split(':')[1]
            item=json.load(tar.extractfile(path))
            config=json.load(tar.extractfile('blobs/sha256/'+item['config']['digest'].split(':')[1]))
            paths=['blobs/sha256/'+layer['digest'].split(':')[1] for layer in item['layers']]
        diff_ids=config['rootfs']['diff_ids']
        assert len(paths)==len(diff_ids)>0
        result=[]
        for path,diff_id in zip(paths,diff_ids):
            with tar.extractfile(path) as incoming:
                compressed=incoming.read(2)==b'\x1f\x8b'
            with tar.extractfile(path) as incoming:
                stream=gzip.GzipFile(fileobj=incoming) if compressed else incoming
                digest=hashlib.sha256();size=0
                while True:
                    block=stream.read(1024**2)
                    if not block:break
                    digest.update(block);size+=len(block)
                assert diff_id=='sha256:'+digest.hexdigest(), 'Uncompressed layer hash differs'
                result.append({'diffId':diff_id,'uncompressedBytes':size})
        return result


if __name__=='__main__':
    with tempfile.TemporaryFile() as file:
        subprocess.run(['docker','image','save',sys.argv[1]],stdout=file,check=True)
        file.flush();file.seek(0)
        print(json.dumps(measure(file)))
