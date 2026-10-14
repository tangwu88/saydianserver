import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest

spec=importlib.util.spec_from_file_location('layers',Path(__file__).with_name('measure-image-layers.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class LayerMeasurement(unittest.TestCase):
    def fixture(self,compressed=False,wrong=False):
        data=b'synthetic layer content';diff='sha256:'+hashlib.sha256(data).hexdigest()
        archive=io.BytesIO()
        entries={'manifest.json':json.dumps([{'Config':'config.json','Layers':['layer.tar']}]).encode(),
                 'config.json':json.dumps({'rootfs':{'diff_ids':['sha256:'+'0'*64 if wrong else diff]}}).encode(),
                 'layer.tar':gzip.compress(data) if compressed else data}
        with tarfile.open(fileobj=archive,mode='w') as output:
            for name,content in entries.items():
                header=tarfile.TarInfo(name);header.size=len(content);output.addfile(header,io.BytesIO(content))
        archive.seek(0);return archive,diff,len(data)

    def test_compressed_and_uncompressed_layers_have_same_verified_cost(self):
        for compressed in [False,True]:
            archive,diff,size=self.fixture(compressed)
            self.assertEqual(module.measure(archive),[{'diffId':diff,'uncompressedBytes':size}])

    def test_refuses_layer_hash_mismatch(self):
        archive,_,_=self.fixture(wrong=True)
        with self.assertRaises(AssertionError):module.measure(archive)

    def test_oci_only_archive_is_also_verified(self):
        data=b'synthetic OCI layer';diff='sha256:'+hashlib.sha256(data).hexdigest()
        config=json.dumps({'rootfs':{'diff_ids':[diff]}}).encode()
        config_hash=hashlib.sha256(config).hexdigest()
        layer=gzip.compress(data);layer_hash=hashlib.sha256(layer).hexdigest()
        manifest=json.dumps({'config':{'digest':'sha256:'+config_hash},'layers':[{'digest':'sha256:'+layer_hash}]}).encode()
        manifest_hash=hashlib.sha256(manifest).hexdigest()
        entries={'index.json':json.dumps({'manifests':[{'digest':'sha256:'+manifest_hash}]}).encode(),
                 'blobs/sha256/'+manifest_hash:manifest,'blobs/sha256/'+config_hash:config,'blobs/sha256/'+layer_hash:layer}
        archive=io.BytesIO()
        with tarfile.open(fileobj=archive,mode='w') as output:
            for name,content in entries.items():
                header=tarfile.TarInfo(name);header.size=len(content);output.addfile(header,io.BytesIO(content))
        archive.seek(0)
        self.assertEqual(module.measure(archive),[{'diffId':diff,'uncompressedBytes':len(data)}])


if __name__=='__main__':unittest.main()
