"""
Compare how different models read the same proformas.

  python3 scripts/archive/compare.py .archive/sample-20.jsonl:gemini .archive/sample-20-low.jsonl:gemini-low .archive/sample-20-grok-a.jsonl+.archive/sample-20-grok-b.jsonl:grok
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from structure import check  # noqa: E402


def load(spec: str):
    paths, name = spec.rsplit(":", 1)
    rows = {}
    for path in paths.split("+"):
        if not Path(path).exists():
            continue
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows[row["sha1"]] = row
    return name, rows


def words(values):
    return set(re.findall(r"[a-z0-9]+", " ".join(values or []).lower()))


def totals(parsed):
    return sorted(round(job.get("total") or 0) for job in parsed.get("jobs", []) if job.get("total"))


def main():
    runs = [load(spec) for spec in sys.argv[1:]]
    base_name, base = runs[0]
    for name, rows in runs:
        valid = [row for row in rows.values() if isinstance(row.get("parsed"), dict)]
        passing = sum(1 for row in valid if not check(row["parsed"]))
        print(f"\n== {name}: {len(valid)} read, {passing} add up exactly")
        if name == base_name:
            continue
        same = {"subtotal": 0, "grandTotal": 0, "jobs": 0, "jobTotals": 0, "transport": 0, "currency": 0, "date": 0}
        material = []
        for sha1, row in rows.items():
            other = base.get(sha1)
            if not other or not isinstance(row.get("parsed"), dict):
                continue
            a, b = other["parsed"], row["parsed"]
            for field in ("subtotal", "grandTotal"):
                same[field] += a.get(field) is not None and b.get(field) is not None and abs(a[field] - b[field]) < 1
            same["jobs"] += len(a.get("jobs", [])) == len(b.get("jobs", []))
            same["jobTotals"] += totals(a) == totals(b)
            for field in ("transport", "currency", "date"):
                same[field] += a.get(field) == b.get(field)
            left = words(m for job in a.get("jobs", []) for m in job.get("materials", []))
            right = words(m for job in b.get("jobs", []) for m in job.get("materials", []))
            if left or right:
                material.append(len(left & right) / max(1, len(left | right)))
            differs = [field for field in ("subtotal", "transport", "date") if a.get(field) != b.get(field)]
            if len(a.get("jobs", [])) != len(b.get("jobs", [])):
                differs.append(f"jobs {len(a.get('jobs', []))} vs {len(b.get('jobs', []))}")
            if differs or check(b):
                print(f"   {row['pi']}: differs from {base_name} on {', '.join(differs) or 'nothing'}; checks: {check(b) or 'ok'}")
        count = sum(1 for sha1 in rows if sha1 in base)
        print(f"   agrees with {base_name} on: " + ", ".join(f"{key} {value}/{count}" for key, value in same.items()))
        if material:
            print(f"   materials wording overlap: {sum(material) / len(material):.0%}")


if __name__ == "__main__":
    main()
