"""Group proformas by file and PI number, and write reader batches.

  python3 scripts/archive/prepare.py --out .archive/grok --batch 75

One meta line per PI number. Reader batches contain only the primary version
of each PI (newest email; ties: more pages, then longer text), newest first.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from structure import clean  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
YEARS = (2024, 2025, 2026)
CHAR_CAP = 90000
EMAIL_KEYS = ("messageId", "date", "from", "to", "subject", "approval")
META_KEYS = ("pi", "sha1", "filename", "pages", "approval", "emails", "siblings", "body", "versions")
EARLIEST = datetime.min.replace(tzinfo=timezone.utc)


def resolve(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def parse_date(value):
    if not isinstance(value, str) or not value.strip():
        return EARLIEST
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return EARLIEST
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def email_key(email):
    return (parse_date(email.get("date")), email.get("date") or "", email.get("messageId") or "")


def sibling_list(record):
    siblings = record.get("siblings")
    return list(siblings) if isinstance(siblings, list) else []


def load_rows():
    for year in YEARS:
        path = ROOT / ".archive" / f"pi-{year}.jsonl"
        if not path.exists():
            sys.exit(f"missing {path}")
        with path.open(encoding="utf-8-sig") as handle:
            for line in handle:
                stripped = line.strip()
                if stripped:
                    yield json.loads(stripped)


def group_files(rows):
    """One record per sha1: every email, approval OR-ed, siblings unioned."""
    files = {}
    for record in rows:
        text = record.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        email = {key: record.get(key, "") for key in EMAIL_KEYS}
        email["approval"] = bool(record.get("approval"))
        email["body"] = record.get("body") if isinstance(record.get("body"), str) else ""
        known = files.get(record["sha1"])
        if known:
            known["emails"].append(email)
            known["approval"] = known["approval"] or email["approval"]
            for sibling in sibling_list(record):
                if sibling not in known["siblings"]:
                    known["siblings"].append(sibling)
            continue
        pages = record.get("pages")
        files[record["sha1"]] = {
            "sha1": record["sha1"],
            "pi": record.get("pi") or "",
            "filename": record.get("filename") or "",
            "pages": pages if isinstance(pages, int) and not isinstance(pages, bool) else 0,
            "text": text,
            "approval": email["approval"],
            "emails": [email],
            "siblings": sibling_list(record),
        }
    return files


def file_rank(file):
    latest = max(parse_date(email.get("date")) for email in file["emails"])
    return (latest, file["pages"], len(file["text"]), file["sha1"])


def version_rank(file):
    dates = [parse_date(email.get("date")) for email in file["emails"]]
    return (min(dates), max(dates), file["sha1"])


def public_email(email):
    return {
        "messageId": email.get("messageId") or "",
        "date": email.get("date") or "",
        "from": email.get("from") or "",
        "to": email.get("to") or "",
        "subject": email.get("subject") or "",
        "approval": bool(email.get("approval")),
    }


def build_metas(files):
    grouped = {}
    for file in files.values():
        grouped.setdefault(file["pi"], []).append(file)
    metas = []
    for pi, versions in grouped.items():
        primary = max(versions, key=file_rank)
        ordered = sorted(versions, key=version_rank)
        emails = [email for version in versions for email in version["emails"]]
        emails.sort(key=email_key)
        siblings = []
        for version in ordered:
            for sibling in version["siblings"]:
                if sibling not in siblings:
                    siblings.append(sibling)
        first = min(primary["emails"], key=email_key)
        body = first.get("body") or ""
        version_rows = []
        for version in ordered:
            dated = sorted(version["emails"], key=email_key)
            version_rows.append(
                {
                    "sha1": version["sha1"],
                    "filename": version["filename"],
                    "firstDate": dated[0].get("date") or "",
                    "lastDate": dated[-1].get("date") or "",
                }
            )
        metas.append(
            {
                "pi": pi,
                "sha1": primary["sha1"],
                "filename": primary["filename"],
                "pages": primary["pages"],
                "approval": any(email["approval"] for email in emails),
                "emails": [public_email(email) for email in emails],
                "siblings": siblings,
                "body": body[:600],
                "versions": version_rows,
                "_text": clean(primary["text"]),
                "_latest": file_rank(primary)[0],
            }
        )
    metas.sort(key=lambda meta: (meta["_latest"], meta["pi"]), reverse=True)
    return metas


def load_done(path):
    if not path.exists():
        return set()
    return {line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()}


def pack(items, batch_size, char_cap):
    """Fill batches up to batch_size items and char_cap characters.

    A single proforma longer than char_cap stays whole, in its own batch.
    """
    batches = []
    current = []
    chars = 0
    for item in items:
        length = len(item["text"])
        if current and (len(current) >= batch_size or chars + length > char_cap):
            batches.append(current)
            current = []
            chars = 0
        current.append(item)
        chars += length
    if current:
        batches.append(current)
    return batches


def write_meta(path, metas):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for meta in metas:
            row = {key: meta[key] for key in META_KEYS}
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_batches(directory, metas, done, batch_size):
    queued = [
        {"sha1": meta["sha1"], "pi": meta["pi"], "text": meta["_text"]}
        for meta in metas
        if meta["pi"] not in done
    ]
    groups = pack(queued, batch_size, CHAR_CAP)
    directory.mkdir(parents=True, exist_ok=True)
    for old in directory.glob("batch-*.jsonl"):
        old.unlink()
    total = 0
    for index, group in enumerate(groups, start=1):
        path = directory / f"batch-{index:03d}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for item in group:
                handle.write(json.dumps({"sha1": item["sha1"], "pi": item["pi"], "text": item["text"]}, ensure_ascii=False) + "\n")
                total += len(item["text"])
    return len(queued), len(groups), total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--batch", type=int, default=75)
    args = parser.parse_args()
    if args.batch < 1:
        sys.exit("--batch must be at least 1")
    out = resolve(args.out)
    metas = build_metas(group_files(load_rows()))
    write_meta(out / "meta.jsonl", metas)
    primaries, batches, chars = write_batches(out / "in", metas, load_done(out / "done.txt"), args.batch)
    print(f"PIs: {len(metas)}")
    print(f"primaries: {primaries}")
    print(f"batches written: {batches}")
    print(f"total chars: {chars}")


if __name__ == "__main__":
    main()
