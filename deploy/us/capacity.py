#!/usr/bin/env python3
"""Host-side pre-pull gate. Does not start containers or print environment data."""
import json
import os
import re
import sys


def capacity(manifest, state, revision, free_bytes):
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
        total += value
    for key in ["infrastructureImageBytes", "databaseBytes", "fileBytes", "backupBytes", "restoreBytes", "transferBytes", "logBytes", "previousReleaseBytes"]:
        value = state.get(key)
        if type(value) is not int or value < 0 or key in {"databaseBytes", "backupBytes", "restoreBytes", "logBytes"} and value == 0:
            raise ValueError("Missing measured " + key)
        total += value
    return {"requiredBytes": total, "freeBytes": free_bytes, "missingBytes": max(0, total-free_bytes), "permitted": free_bytes >= total}


if __name__ == "__main__":
    revision, manifest_file, state_file, directory = sys.argv[1:]
    fs = os.statvfs(directory)
    report = capacity(json.load(open(manifest_file)), json.load(open(state_file)), revision, fs.f_bavail * fs.f_frsize)
    print(json.dumps(report))
    sys.exit(0 if report["permitted"] else 2)
