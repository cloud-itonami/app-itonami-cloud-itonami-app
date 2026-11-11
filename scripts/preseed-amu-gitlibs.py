#!/usr/bin/env python3
"""Pre-seed the gitlibs checkouts the CI resolvers will verify.

Two resolvers share ~/.gitlibs in this job:

1. amu's --jvm-free resolver reads <amu-checkout>/deps-lock.edn (its own
   root, derived from bin/amu's location). The amu overlay
   (amu-deps-lock.edn) covers those 21 entries; its verifier fail-closes
   on pinned sha + recorded paths.
2. kbb's `bb uberjar` runs real tools.deps over the app graph (no aliases;
   monorepo redirects come from monorepo-sourced manifests like inga's).
   tools.deps needs each entry's manifest plus the manifest's :paths and
   its :local/root closure -- the monorepo libs form a dense :local/root
   mesh, so each checkout is seeded with the transitive closure rooted at
   its entry, computed from the mirror. tools.deps tolerates manifest
   :paths that do not exist (measured: the lock regen's own `clojure
   -Spath` succeeds with lib/kotoba.docs/src absent), so missing paths
   warn instead of failing; a missing closure member dir fails, since
   tools.deps cannot resolve through it.

A naive resolve full-clones the 433 MiB monorepo per coordinate (~80 GiB
for the app closure) and fills the runner disk. This script clones one
mirror per repo URL and seeds every checkout sparse. Both resolvers still
fail-close, so nothing is weakened.

Single source of truth: deps-lock.edn + amu-deps-lock.edn (entry set)
cross-checked against the mirrors (existence). Idempotent: a dir already
at the pinned sha is re-sparsed to the computed pattern set; a dir at any
other sha is removed and re-seeded.

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
MANIFEST_PATHS_RE = re.compile(r'\{:paths \[([^\]]*)\]')
LOCAL_ROOT_RE = re.compile(r':local/root "([^"]+)"')


def sh(args, **kw):
    r = subprocess.run(args, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError("%s failed: %s" % (" ".join(args), (r.stderr or "").strip()))
    return r.stdout.strip()


def load_entries(path):
    entries = ENTRY_RE.findall(open(path).read())
    if not entries:
        raise RuntimeError("no entries parsed from %s" % path)
    return entries


def show(mirror, sha, path):
    r = subprocess.run(["git", "-C", mirror, "show", "%s:%s" % (sha, path)],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def resolve(base, rel):
    out = []
    for s in (base + "/" + rel).split("/"):
        if s in (".", ""):
            continue
        if s == "..":
            if out:
                out.pop()
        else:
            out.append(s)
    return "/".join(out)


def main(root):
    strict = set()  # coords from the amu overlay: verifier-checked, fail hard
    entries = []
    for lock in ("deps-lock.edn", "amu-deps-lock.edn"):
        for coord, url, sha, paths_raw in load_entries(os.path.join(root, lock)):
            entries.append((coord, url, sha, paths_raw))
            if lock == "amu-deps-lock.edn":
                strict.add((coord, url, sha))
    gitlibs = os.environ.get("GITLIBS", os.path.join(os.path.expanduser("~"), ".gitlibs"))
    # one mirror per repo url
    mirrors = {}
    for i, url in enumerate(sorted({u for _, u, _, _ in entries})):
        slug = re.sub(r"[^A-Za-z0-9]+", "-", url).strip("-")
        mirror = os.path.join(root, "target", "mirrors", "%02d-%s" % (i, slug))
        mirrors[url] = mirror
        if os.path.isdir(mirror):
            try:
                for s in {s for _, u, s, _ in entries if u == url}:
                    sh(["git", "-C", mirror, "cat-file", "-t", s])
                continue
            except RuntimeError:
                subprocess.run(["rm", "-rf", mirror], check=True)
        else:
            os.makedirs(os.path.dirname(mirror), exist_ok=True)
            sh(["git", "clone", "--quiet", "--no-checkout", url, mirror])
    # seed plan per checkout dir
    plans = {}
    for coord, url, sha, paths_raw in entries:
        group, artifact = coord.split("/", 1)
        name = artifact if "/" not in artifact else artifact.split("/", 1)[1]
        dest = os.path.join(gitlibs, "libs", group, name, sha)
        plan = plans.setdefault(dest, {"url": url, "sha": sha, "strict": False,
                                       "roots": set(), "extra": set()})
        if plan["url"] != url or plan["sha"] != sha:
            raise RuntimeError("conflicting entries for %s" % dest)
        plan["strict"] = plan["strict"] or (coord, url, sha) in strict
        for p in re.findall(r'"([^"]+)"', paths_raw):
            plan["extra"].add(p if p.endswith("/") else p + "/")
            segs = p.strip("/").split("/")
            if len(segs) >= 2:
                plan["roots"].add(segs[0] + "/" + segs[1])
            else:
                plan["roots"].add("")
    for dest, plan in sorted(plans.items()):
        mirror = mirrors[plan["url"]]
        sha = plan["sha"]
        # transitive :local/root closure over manifests in the mirror
        members = set(plan["roots"])
        stack = list(plan["roots"])
        while stack:
            r = stack.pop()
            text = show(mirror, sha, (r + "/" if r else "") + "deps.edn")
            if text is None:
                continue
            base = r
            found = []
            m = MANIFEST_PATHS_RE.search(text)
            if m:
                found += [resolve(base, q) for q in re.findall(r'"([^"]+)"', m.group(1))]
            found += [resolve(base, q) for q in LOCAL_ROOT_RE.findall(text)]
            for f in found:
                if f not in members:
                    members.add(f)
                    stack.append(f)
        patterns = set(plan["extra"])
        patterns.add("deps.edn")
        missing = []
        for r in members:
            if r == "":
                continue
            probe = subprocess.run(["git", "-C", mirror, "ls-tree", sha, r],
                                   capture_output=True, text=True)
            if not probe.stdout.strip():
                missing.append(r)
                continue
            patterns.add(r if r.endswith("/") else r + "/")
            patterns.add(r + "/deps.edn")
        if missing:
            msg = "closure members absent at %s in %s: %s" % (sha[:8], plan["url"], sorted(missing))
            if plan["strict"]:
                raise RuntimeError(msg)
            print("warning: %s" % msg)
        for p in sorted(plan["extra"]):
            probe = subprocess.run(["git", "-C", mirror, "ls-tree", sha, p.strip("/")],
                                   capture_output=True, text=True)
            if not probe.stdout.strip():
                patterns.discard(p)
                msg = "entry path absent at %s in %s: %s" % (sha[:8], plan["url"], p)
                if plan["strict"]:
                    raise RuntimeError(msg)
                print("warning: %s" % msg)
        patterns = sorted(patterns)
        try:
            if os.path.isdir(dest) and sh(["git", "-C", dest, "rev-parse", "HEAD"]) == sha:
                sh(["git", "-C", dest, "sparse-checkout", "set", "--no-cone"] + patterns)
                print("reuse %s (%d patterns)" % (dest, len(patterns)))
                continue
        except RuntimeError:
            pass
        subprocess.run(["rm", "-rf", dest], check=True)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        sh(["git", "clone", "--quiet", "--no-checkout", "--shared", mirror, dest])
        sh(["git", "-C", dest, "sparse-checkout", "set", "--no-cone"] + patterns)
        sh(["git", "-C", dest, "checkout", "--quiet", sha])
        print("seeded %s (%d patterns)" % (dest, len(patterns)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
