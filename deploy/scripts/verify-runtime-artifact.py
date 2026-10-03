"""Extract only the verified CI image archive, never arbitrary ZIP paths."""
import hashlib
import json
import pathlib
import stat
import sys
import zipfile


def verify(revision, payload, downloads):
    payload, downloads = pathlib.Path(payload), pathlib.Path(downloads)
    metadata = json.loads((payload / "runtime-artifact.json").read_text())
    archive = downloads / "runtime.zip"
    assert archive.stat().st_size == metadata["sizeBytes"]
    with archive.open("rb") as source:
        digest = hashlib.sha256()
        while block := source.read(1024 ** 2):
            digest.update(block)
        assert "sha256:" + digest.hexdigest() == metadata["digest"]
    name = f"saydianapp-runtime-images-{revision}.tar.gz"
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        assert len(entries) == 3 and {entry.filename for entry in entries} == {name, name + ".sha256", "release-manifest.json"}
        for entry in entries:
            mode = entry.external_attr >> 16
            assert not stat.S_ISLNK(mode) and (stat.S_IFMT(mode) in (0, stat.S_IFREG))
            assert entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            assert entry.file_size <= metadata["sizeBytes"]
        assert source.getinfo("release-manifest.json").file_size <= 1024 ** 2
        assert source.read("release-manifest.json") == (payload / "release-manifest.json").read_bytes()
        assert source.getinfo(name + ".sha256").file_size <= 512
        checksum, filename = source.read(name + ".sha256").decode().split()
        assert pathlib.PurePosixPath(filename).name == name and len(checksum) == 64
        target = downloads / "images.tar.gz"
        with source.open(name) as incoming, target.open("xb") as output:
            digest = hashlib.sha256()
            while block := incoming.read(1024 ** 2):
                digest.update(block)
                output.write(block)
        assert digest.hexdigest() == checksum
    return {"revision": revision, "archiveVerified": True}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(*sys.argv[1:])))
    except Exception:
        print("Original artifact ZIP, manifest or archive validation failed; nothing imported.", file=sys.stderr)
        sys.exit(1)
