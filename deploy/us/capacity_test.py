import unittest
from capacity import capacity

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


if __name__ == "__main__":
    unittest.main()
