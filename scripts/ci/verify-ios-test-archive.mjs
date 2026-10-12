import { execFileSync } from 'node:child_process';

// Inspect tar headers with the host's standard parser before extraction can follow a link.
const validation = String.raw`
"""Reject unsafe tar headers before extraction can follow an archive-controlled link."""

import posixpath
import sys
import tarfile


def verify(path):
    with tarfile.open(path, "r:") as archive:
        entries = archive.getmembers()
        names = set()
        links = set()
        for item in entries:
            name = item.name.rstrip("/")
            parts = name.split("/")
            if (
                parts[0] != "products"
                or any(part in ("", ".", "..") for part in parts)
                or any(character in name for character in ("\\", "\r", "\n", "\0"))
                or name in names
                or not (item.isfile() or item.isdir() or item.issym())
            ):
                raise ValueError("Unsafe native product archive entry")
            names.add(name)
            if item.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname))
                if item.linkname.startswith("/") or not target.startswith("products/"):
                    raise ValueError("Native product archive symlink escapes its root")
                links.add(name)
        # Validate the whole header set first: later entries must never write through a symlink.
        for name in names:
            parent = posixpath.dirname(name)
            while parent:
                if parent in links:
                    raise ValueError("Native archive entry traverses a symlink")
                parent = posixpath.dirname(parent)
        if "products" not in names:
            raise ValueError("Missing native product archive root")


if __name__ == "__main__":
    verify(sys.argv[1])

`;

execFileSync('python3', ['-c', validation, process.argv[2]], { stdio: 'inherit' });
