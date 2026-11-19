"""Join reader JSON onto the proforma catalog.

  python3 scripts/archive/merge.py --grok .archive/grok --out .archive/past-quotes.jsonl

Reads .archive/grok/out/batch-*/part-*.json. Pilot parts are included only
with --include-pilot. The last file written wins when one PI appears twice.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from structure import check  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
JOB_TYPES = ("build", "print", "installation", "transport", "maintenance", "rental", "mixed", "other")
NUMBER_FIELDS = ("subtotal", "vatPercent", "vat", "grandTotal")
JOB_NUMBERS = ("quantity", "unitPrice", "total")
TRANSPORT_EXCLUDED = re.compile(
    r"(excluding|excluded|not\s+including|not\s+included|without)\W{0,3}(the\s+)?(transport|transportation|delivery)"
    r"|(transport|transportation|delivery)\W{0,3}(is\s+|are\s+)?(excluded|not\s+included)",
    re.IGNORECASE,
)
PURCHASE_ORDER = re.compile(r"purchase\s+order", re.IGNORECASE)


def resolve(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def as_number(value):
    """Turn 1350, "2", or "$1,350.00" into a float. Anything else becomes None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return None
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip().replace(",", "")
    text = re.sub(r"^[^\d\-]+", "", text)
    text = re.sub(r"[^\d.\-].*$", "", text)
    if text in ("", "-", ".", "-."):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def normalize(parsed):
    normalized = dict(parsed)
    for key in ("shared", "notes"):
        if not isinstance(normalized.get(key), list):
            normalized[key] = []
    jobs = []
    raw_jobs = normalized.get("jobs")
    if isinstance(raw_jobs, list):
        for job in raw_jobs:
            if not isinstance(job, dict):
                continue
            copy = dict(job)
            for key in ("sizes", "materials"):
                if not isinstance(copy.get(key), list):
                    copy[key] = []
            for key in JOB_NUMBERS:
                if key in copy:
                    copy[key] = as_number(copy[key])
            if not isinstance(copy.get("name"), str):
                copy["name"] = "" if copy.get("name") is None else str(copy.get("name"))
            jobs.append(copy)
    normalized["jobs"] = jobs
    for key in NUMBER_FIELDS:
        if key in normalized:
            normalized[key] = as_number(normalized[key])
    currency = normalized.get("currency")
    if isinstance(currency, str):
        normalized["currency"] = currency.strip().upper()
    job_type = normalized.get("jobType")
    if not isinstance(job_type, str) or not job_type.strip():
        normalized["jobType"] = "other"
    else:
        normalized["jobType"] = job_type.strip()
    return normalized


def label(path, root):
    try:
        return str(path.relative_to(root))
    except ValueError:
        return path.name


def load_meta(path):
    by_sha = {}
    by_pi = {}
    order = []
    with path.open(encoding="utf-8-sig") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            record = json.loads(stripped)
            by_sha[record["sha1"]] = record
            by_pi[record["pi"]] = record
            order.append(record["pi"])
    return by_sha, by_pi, order


def part_files(grok, include_pilot):
    files = list((grok / "out").glob("batch-*/part-*.json"))
    if include_pilot:
        files += list((grok / "pilot").glob("part-*.json"))
    files.sort(key=lambda path: (path.stat().st_mtime_ns, str(path)))
    return files


def read_part(path, grok):
    name = label(path, grok)
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        print(name)
        return []
    if not isinstance(data, list):
        print(name)
        return []
    accepted = []
    for item in data:
        sha1 = item.get("sha1") if isinstance(item, dict) else None
        parsed = item.get("parsed") if isinstance(item, dict) else None
        if not isinstance(sha1, str) or not sha1 or not isinstance(parsed, dict):
            print(f"missing sha1/parsed: {name}")
            continue
        accepted.append(item)
    return accepted


def as_list(value):
    return value if isinstance(value, list) else []


def load_texts(grok):
    texts = {}
    for path in sorted((grok / "in").glob("batch-*.jsonl")):
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            if isinstance(record.get("sha1"), str):
                texts[record["sha1"]] = record.get("text") or ""
    return texts


def pricing(parsed, text):
    """lines: each job price stands alone. total: one price covers unpriced jobs too. none: not a price to learn from."""
    if PURCHASE_ORDER.search(text):
        return "none"
    amounts = [parsed.get(key) for key in ("subtotal", "grandTotal")]
    amounts += [job.get(key) for job in parsed["jobs"] for key in ("total", "unitPrice")]
    if not any(value and value > 0 for value in amounts):
        return "none"
    priced = [job.get("total") is not None or job.get("unitPrice") is not None for job in parsed["jobs"]]
    if any(priced) and not all(priced):
        return "total"
    return "lines"


def row_from(item, meta, text=""):
    parsed = normalize(item["parsed"])
    source = meta or {}
    pages = source.get("pages")
    return {
        "sha1": source.get("sha1") or item["sha1"],
        "pi": source.get("pi") or item.get("pi") or "",
        "filename": source.get("filename") or "",
        "pages": pages if isinstance(pages, int) and not isinstance(pages, bool) else 0,
        "approval": source.get("approval") is True,
        "emails": as_list(source.get("emails")),
        "siblings": as_list(source.get("siblings")),
        "body": source.get("body") if isinstance(source.get("body"), str) else "",
        "parsed": parsed,
        "problems": check(parsed),
        "versions": as_list(source.get("versions")),
        "jobType": parsed.get("jobType") or "other",
        "pricing": pricing(parsed, text),
        "transportExcluded": bool(TRANSPORT_EXCLUDED.search(text)),
        "reader": "grok",
    }


def batch_key(name):
    match = re.search(r"(\d+)", name)
    return (int(match.group(1)) if match else 0, name)


def incomplete_batches(grok, output_counts):
    directory = grok / "in"
    if not directory.exists():
        return []
    missing = []
    for path in directory.glob("batch-*.jsonl"):
        inputs = sum(1 for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip())
        if output_counts.get(path.stem, 0) < inputs:
            missing.append(path.stem)
    missing.sort(key=batch_key)
    return missing


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grok", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--include-pilot", action="store_true")
    args = parser.parse_args()
    grok = resolve(args.grok)
    meta_path = grok / "meta.jsonl"
    if not meta_path.exists():
        sys.exit(f"no meta file: {meta_path}")
    by_sha, by_pi, meta_pis = load_meta(meta_path)
    texts = load_texts(grok)
    kept = {}
    order = []
    output_counts = Counter()
    for path in part_files(grok, args.include_pilot):
        batch = path.parent.name
        for item in read_part(path, grok):
            if batch.startswith("batch-"):
                output_counts[batch] += 1
            meta = by_sha.get(item["sha1"]) or (by_pi.get(item.get("pi")) if isinstance(item.get("pi"), str) else None)
            row = row_from(item, meta, texts.get((meta or {}).get("sha1") or item["sha1"], ""))
            pi = row["pi"]
            if pi in kept:
                print(f"warning: {pi} appears again in {label(path, grok)}; keeping the last file")
            else:
                order.append(pi)
            kept[pi] = row
    rows = [kept[pi] for pi in order]
    counts = Counter(row["jobType"] for row in rows)
    produced = {row["pi"] for row in rows}
    missing = sum(1 for pi in dict.fromkeys(meta_pis) if pi not in produced)
    incomplete = incomplete_batches(grok, output_counts)
    text = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    write_atomic(resolve(args.out), text)
    print(f"rows: {len(rows)}")
    print("jobType:")
    seen = set()
    for name in JOB_TYPES:
        print(f"  {name}: {counts.get(name, 0)}")
        seen.add(name)
    for name in sorted(counts):
        if name not in seen:
            print(f"  {name}: {counts[name]}")
    print(f"with problems: {sum(1 for row in rows if row['problems'])}")
    print("pricing: " + ", ".join(f"{name} {count}" for name, count in Counter(row["pricing"] for row in rows).most_common()))
    print(f"transport excluded in text: {sum(1 for row in rows if row['transportExcluded'])}")
    print(f"no output yet: {missing}")
    print("incomplete: " + (", ".join(incomplete) if incomplete else "none"))


if __name__ == "__main__":
    main()
