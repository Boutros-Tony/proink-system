"""
Delete stored attachments that no job folder links to.

A store file whose link count is 1 is only the copy in the store. Job folders
hold hard links, so a file still in use has a count of 2 or more.

  python3 scripts/archive/prune_store.py --store .archive/files --dry-run
  python3 scripts/archive/prune_store.py --store .archive/files
"""

import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    store = Path(args.store)
    if not store.is_dir():
        print(f"no store at {store}", file=sys.stderr)
        return
    removed = 0
    for path in sorted(store.rglob("*")):
        if not path.is_file():
            continue
        if path.stat().st_nlink != 1:
            continue
        removed += 1
        print(path)
        if not args.dry_run:
            path.unlink()
    if not args.dry_run:
        for path in sorted(store.rglob("*"), reverse=True):
            if path.is_dir() and path != store and not any(path.iterdir()):
                path.rmdir()
    print(f"{removed} unused", file=sys.stderr)


if __name__ == "__main__":
    main()
