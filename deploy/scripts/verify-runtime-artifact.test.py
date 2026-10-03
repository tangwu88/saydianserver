import hashlib
import json
import pathlib
import runpy
import tempfile
import unittest
import zipfile

verify = runpy.run_path(str(pathlib.Path(__file__).with_name("verify-runtime-artifact.py")))["verify"]


class ArtifactTests(unittest.TestCase):
    def fixture(self, extra=None, manifest=b"{}", compression=zipfile.ZIP_STORED, symlink=False):
        temporary = tempfile.TemporaryDirectory(prefix="saydian-zip-test-")
        self.addCleanup(temporary.cleanup)
        root = pathlib.Path(temporary.name)
        payload, downloads = root / "payload", root / "downloads"
        payload.mkdir()
        downloads.mkdir()
        revision = "a" * 40
        name = f"saydianapp-runtime-images-{revision}.tar.gz"
        image = b"verified synthetic archive"
        (payload / "release-manifest.json").write_bytes(b"{}")
        with zipfile.ZipFile(downloads / "runtime.zip", "w", compression=compression, compresslevel=0) as archive:
            archive.writestr("release-manifest.json", manifest)
            image_entry = zipfile.ZipInfo(name)
            if symlink:
                image_entry.external_attr = 0o120777 << 16
            archive.writestr(image_entry, image)
            archive.writestr(name + ".sha256", hashlib.sha256(image).hexdigest() + "  export/" + name)
            if extra:
                archive.writestr(extra, b"unexpected")
        data = (downloads / "runtime.zip").read_bytes()
        (payload / "runtime-artifact.json").write_text(json.dumps({"sizeBytes": len(data), "digest": "sha256:" + hashlib.sha256(data).hexdigest()}))
        return revision, payload, downloads

    def test_extracts_only_verified_archive_with_stored_or_level_zero_entries(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            args = self.fixture(compression=compression)
            self.assertTrue(verify(*args)["archiveVerified"])
            self.assertEqual((args[2] / "images.tar.gz").read_bytes(), b"verified synthetic archive")

    def test_rejects_extra_paths_and_different_manifests_before_extraction(self):
        for args in (self.fixture(extra="../escape"), self.fixture(manifest=b'{"modified":true}'), self.fixture(symlink=True)):
            with self.assertRaises(AssertionError):
                verify(*args)
            self.assertFalse((args[2] / "images.tar.gz").exists())

    def test_rejects_corruption_and_never_overwrites_existing_target(self):
        revision, payload, downloads = self.fixture()
        metadata = json.loads((payload / "runtime-artifact.json").read_text())
        metadata["digest"] = "sha256:" + "0" * 64
        (payload / "runtime-artifact.json").write_text(json.dumps(metadata))
        with self.assertRaises(AssertionError):
            verify(revision, payload, downloads)
        args = self.fixture()
        (args[2] / "images.tar.gz").write_bytes(b"original")
        with self.assertRaises(FileExistsError):
            verify(*args)
        self.assertEqual((args[2] / "images.tar.gz").read_bytes(), b"original")


if __name__ == "__main__":
    unittest.main()
