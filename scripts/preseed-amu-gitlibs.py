#!/usr/bin/env python3
"""Pre-seed the gitlibs checkouts amu's --jvm-free resolver will verify.

amu's lock resolver (src/kotoba/compiler/nbb/classpath.cljs at the pinned
amu) materializes every lock entry with a full `git clone` + full-tree
checkout. The amu overlay lock (amu-deps-lock.edn) maps all 21 entries to
one 433 MiB monorepo tree, so a naive resolve clones and checks out that
tree 21 times (~13 GiB) and risks filling the runner disk. This script
pre-creates each checkout dir once from a single shared mirror with a
sparse checkout limited to the entry's recorded paths. The resolver then
finds the dirs present, and its own fail-closed gates (HEAD == pinned sha,
recorded paths exist) still verify every entry -- nothing is weakened.

Single source of truth: amu-deps-lock.edn (same entry regex the lock uses).
Idempotent: a dir already at the pinned sha is left alone; a dir at any
other sha is removed and re-seeded so a stale cache can never poison a run.

Usage: python3 scripts/preseed-amu-gitlibs.py <repo-root>
"""
import os
import re
import subprocess
import sys

ENTRY_RE = re.compile(
    r'\{:coordinate "([^"]+)"\s+'
    r':git-url "([^"]+)"\s+'
    r':git-sha "([^"]+)"\s+'
    r':paths \[([^\]]*)\] \}'
)


def sh(args, **kw):
    r = subprocess.run(args, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError("%s failed: %s" % (" ".join(args), (r.stderr or "").strip()))
    return r.stdout.strip()


def main(root):
    text = open(os.path.join(root, "amu-deps-lock.edn")).read()
    entries = ENTRY_RE.findall(text)
    if not entries:
        raise RuntimeError("no entries parsed from amu-deps-lock.edn")
    gitlibs = os.environ.get("GITLIBS", os.path.join(os.path.expanduser("~"), ".gitlibs"))
    by_url = {}
    for coord, url, sha, _ in entries:
        by_url.setdefault(url, set()).add(sha)
    if len(by_url) != 1:
        raise RuntimeError("overlay must map to a single mirror repo, got %r" % sorted(by_url))
    url = next(iter(by_url))
    mirror = os.path.join(root, "target", "monorepo-mirror")
    if os.path.isdir(mirror):
        try:
            sh(["git", "-C", mirror, "cat-file", "-t", next(iter(by_url[url]))])
        except RuntimeError:
            subprocess.run(["rm", "-rf", mirror], check=True)
    if not os.path.isdir(mirror):
        sh(["git", "clone", "--quiet", "--no-checkout", url, mirror])
    for coord, _url, sha, paths_raw in entries:
        group, artifact = coord.split("/", 1)
        name = artifact if "/" not in artifact else artifact.split("/", 1)[1]
        dest = os.path.join(gitlibs, "libs", group, name, sha)
        try:
            if os.path.isdir(dest) and sh(["git", "-C", dest, "rev-parse", "HEAD"]) == sha:
                print("reuse %s" % dest)
                continue
        except RuntimeError:
            pass
        subprocess.run(["rm", "-rf", dest], check=True)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        sh(["git", "clone", "--quiet", "--no-checkout", "--shared", mirror, dest])
        paths = re.findall(r'"([^"]+)"', paths_raw)
        if not paths:
            raise RuntimeError("entry %s has no paths" % coord)
        patterns = [p if p.endswith("/") else p + "/" for p in paths]
        sh(["git", "-C", dest, "sparse-checkout", "set", "--no-cone"] + patterns)
        sh(["git", "-C", dest, "checkout", "--quiet", sha])
        print("seeded %s (%d paths)" % (dest, len(paths)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
