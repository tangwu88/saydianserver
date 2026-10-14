import unittest
from capacity import capacity,incremental_images

SHA = "a" * 40
MANIFEST = {"schemaVersion": 1, "revision": SHA, "images": {
    n: {"ref": "ghcr.io/tangwu88/saydianserver-"+n+"@sha256:"+"b"*64, "sizeBytes": s}
    for n, s in [("api", 100), ("worker", 200), ("admin", 300)]}}
STATE = {"schemaVersion": 1, "host": "47.85.43.52", "site": "us", "infrastructureImageBytes": 40,
         "databaseBytes": 10, "fileBytes": 20, "backupBytes": 30, "restoreBytes": 40,
         "transferBytes": 50, "logBytes": 60, "previousReleaseBytes": 70}


class CapacityGate(unittest.TestCase):
    def test_matches_node_gate_and_rejects_one_byte_short(self):
        required = 5*1024**3+920
        self.assertTrue(capacity(MANIFEST, STATE, SHA, required)["permitted"])
        self.assertEqual(capacity(MANIFEST, STATE, SHA, required-1)["missingBytes"], 1)

    def test_does_not_accept_missing_estimates_or_mutable_images(self):
        for key in ["site", "host", "databaseBytes", "restoreBytes", "backupBytes"]:
            value = dict(STATE)
            del value[key]
            with self.assertRaises(ValueError):
                capacity(MANIFEST, value, SHA, 10*1024**3)
        with self.assertRaises(ValueError):
            capacity(MANIFEST, STATE, "c"*40, 10*1024**3)

    def test_resident_immutable_images_do_not_need_a_second_copy(self):
        cost=incremental_images(MANIFEST,lambda ref:{'RepoDigests':[ref]},set())
        self.assertEqual(cost,3*1024**2)
        self.assertEqual(capacity(MANIFEST,STATE,SHA,10*1024**3,cost,0)['requiredBytes'],
                         5*1024**3+cost+280)

    def test_counts_only_missing_verified_layers_and_preserves_old_manifest_gate(self):
        from copy import deepcopy
        manifest=deepcopy(MANIFEST)
        for image in manifest['images'].values():image['layers']=[{'diffId':'sha256:'+'c'*64,'uncompressedBytes':100}]
        self.assertEqual(incremental_images(manifest,lambda _:None,{'sha256:'+'c'*64}),3*1024**2)
        self.assertEqual(incremental_images(manifest,lambda _:None,set()),3*1024**2+120+16*1024**2)
        self.assertEqual(incremental_images(MANIFEST,lambda _:None,set()),600)
        manifest['images']['api']['layers'][0]['diffId']='untrusted'
        with self.assertRaises(AssertionError):incremental_images(manifest,lambda _:None,set())


if __name__ == "__main__":
    unittest.main()
