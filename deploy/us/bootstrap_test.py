import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import bootstrap


class FreshBootstrap(unittest.TestCase):
    def test_fixed_infrastructure_identity_and_official_sources(self):
        sources={'minio':'72cff79c8a7cc59bccb591995e3c3ed6aa2f4cd5','mc':'2c94b8d03979ed96a6379ecabc3435b271398efc'}
        manifest={'schemaVersion':1,'site':'us','revision':'a'*40,'images':{
            name:{'ref':'ghcr.io/tangwu88/saydianserver-us-'+name+'@sha256:'+'b'*64,
                  'imageId':'sha256:'+'b'*64,'sizeBytes':100,'sourceRevision':source}
            for name,source in sources.items()}}
        self.assertEqual(bootstrap.infrastructure(manifest),200)
        manifest['images']['minio']['ref']='minio/minio:latest'
        with self.assertRaises(AssertionError):bootstrap.infrastructure(manifest)

    def test_failure_does_not_expose_subprocess_credentials(self):
        previous=bootstrap.ROOT
        try:
            with tempfile.TemporaryDirectory() as directory:
                bootstrap.ROOT=Path(directory)
                (bootstrap.ROOT/'private').mkdir(mode=0o700)
                with self.assertRaisesRegex(RuntimeError,'root-only') as failure:
                    bootstrap.run(['python3','-c',"import sys; print('synthetic-private-credential');sys.exit(1)"])
                self.assertNotIn('synthetic-private-credential',str(failure.exception))
                self.assertIn('synthetic-private-credential',(bootstrap.ROOT/'private/bootstrap-error.log').read_text())
        finally:bootstrap.ROOT=previous

    def test_approved_legal_pair_is_exact_and_contains_us_origin(self):
        directory=Path(__file__).parent/'legal'
        manifest=json.loads((directory/'approved.json').read_text())
        self.assertTrue(manifest['reviewed'])
        self.assertEqual(len(manifest['documents']),2)
        for doc in manifest['documents']:
            content=(directory/doc['file']).read_bytes()
            self.assertEqual(hashlib.sha256(content).hexdigest(),doc['sha256'])
            self.assertIn('https://app.saydian.com',content.decode())


if __name__ == '__main__':unittest.main()
