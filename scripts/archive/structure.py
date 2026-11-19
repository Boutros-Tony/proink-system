"""
Turn each proforma's text into items, with a cheap model, and check the numbers with code.

The PDF text comes out partly out of order, so a fixed parser would put prices on the wrong lines.
The model only reads; code checks that the items add up to the total printed on the proforma.

  python3 scripts/archive/structure.py --in .archive/pi-2025.jsonl --out .archive/pi-2025.structured.jsonl
"""

import argparse
import concurrent.futures
import json
import os
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = "gemini-3.8-flash"
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

PROMPT = """You read one proforma invoice (quotation) from ProInk, a stand and display builder in Lebanon.
The text was pulled from a PDF, so lines can be out of order: a price can appear before or after the lines that describe it.
Return the proforma as JSON. Copy numbers exactly as printed. Never invent a price, size, or quantity.

- jobs: one entry per priced job or line. A job is a named thing with a price, such as "Job A: EG Break $500.00", or "Podiums (A) 8 $1,350 $10,800.00".
  - name: the job's name, without the price.
  - section: the area or group it is under, such as "JOB A Ground floor" or "Location A", or null.
  - quantity: the quantity printed for it, or null.
  - unitPrice: the unit price printed, or null.
  - total: the price for the whole job as printed, or null if none is printed.
  - sizes: every size written for it, as printed, such as "w 220cm x h 80cm".
  - materials: the material and finish lines that describe it, such as "Wood MDF + painting", "Shelves plexi + polycarbonate", "indirect lighting".
- shared: description lines that apply to the whole proforma, not to one job.
- currency: USD, LBP, or EUR.
- subtotal: "Total HTC" before VAT. vatPercent. vat: the VAT amount. grandTotal: "Grand Total TTC".
- transport: "included", "excluded", or "unknown", from what the proforma says about transportation and installation.
- client, attention, title, date (as YYYY-MM-DD), ref: from the header.
- terms: payment terms and validity as printed, or null.
- notes: exclusions and other remarks, such as "Excluding signage".
Reply with only the JSON object."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "ref": {"type": "STRING"},
        "date": {"type": "STRING"},
        "client": {"type": "STRING"},
        "attention": {"type": "STRING", "nullable": True},
        "title": {"type": "STRING", "nullable": True},
        "currency": {"type": "STRING", "enum": ["USD", "LBP", "EUR"]},
        "jobs": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "section": {"type": "STRING", "nullable": True},
                    "quantity": {"type": "NUMBER", "nullable": True},
                    "unitPrice": {"type": "NUMBER", "nullable": True},
                    "total": {"type": "NUMBER", "nullable": True},
                    "sizes": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "materials": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["name", "quantity", "unitPrice", "total", "sizes", "materials"],
            },
        },
        "shared": {"type": "ARRAY", "items": {"type": "STRING"}},
        "subtotal": {"type": "NUMBER", "nullable": True},
        "vatPercent": {"type": "NUMBER", "nullable": True},
        "vat": {"type": "NUMBER", "nullable": True},
        "grandTotal": {"type": "NUMBER", "nullable": True},
        "transport": {"type": "STRING", "enum": ["included", "excluded", "unknown"]},
        "terms": {"type": "STRING", "nullable": True},
        "notes": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["ref", "date", "client", "currency", "jobs", "subtotal", "grandTotal", "transport", "shared", "notes"],
}


def api_key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("GOOGLE_GENERATIVE_AI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    return os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY", "")


FOOTER = re.compile(r"^.*(Dekweneh 1161 Bldg|CR# 2050179|VAT# 3339393).*$", re.M)


def clean(text: str):
    return re.sub(r"\n{3,}", "\n\n", FOOTER.sub("", text)).strip()


THINKING: str | None = None


def ask(key: str, text: str):
    config = {"temperature": 0, "responseMimeType": "application/json", "responseSchema": SCHEMA}
    if THINKING:
        config["thinkingConfig"] = {"thinkingLevel": THINKING}
    body = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT + "\n\n<proforma>\n" + text + "\n</proforma>"}]}],
        "generationConfig": config,
    }
    request = urllib.request.Request(URL.format(model=MODEL, key=key), data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read())
            usage = payload.get("usageMetadata", {})
            reply = payload["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(reply), usage
        except Exception as error:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
            last = error
    raise last  # pragma: no cover


def check(result: dict):
    """What does not add up. An empty list means the jobs match the printed subtotal."""
    problems = []
    jobs = result.get("jobs", [])
    for job in jobs:
        quantity, unit, total = job.get("quantity"), job.get("unitPrice"), job.get("total")
        if quantity and unit and total and abs(quantity * unit - total) > 1:
            problems.append(f"{job['name']}: {quantity} × {unit} is not {total}")
    priced = [job.get("total") if job.get("total") is not None else (job.get("unitPrice") if job.get("quantity") in (None, 1) else None) for job in jobs]
    subtotal = result.get("subtotal")
    # Many quotes print only line prices ("all prices excluding VAT"), or only a grand total with no VAT.
    if subtotal is None and result.get("vat") is None:
        subtotal = result.get("grandTotal")
    if subtotal is None:
        if not jobs or any(value is None for value in priced):
            problems.append("no subtotal")
    elif any(value is None for value in priced):
        problems.append("a job has no price")
    elif abs(sum(priced) - subtotal) > max(1, subtotal * 0.005):
        problems.append(f"jobs add up to {sum(priced):,.2f}, the proforma says {subtotal:,.2f}")
    vat, grand = result.get("vat"), result.get("grandTotal")
    if subtotal and grand and vat is not None and abs(subtotal + vat - grand) > 1:
        problems.append(f"{subtotal} + VAT {vat} is not {grand}")
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--thinking", choices=["minimal", "low", "medium", "high"], default=None)
    parser.add_argument("--dump", help="Write the selected proformas' cleaned text here instead of calling the model.")
    args = parser.parse_args()
    global THINKING
    THINKING = args.thinking
    key = api_key()
    if not key:
        sys.exit("No GOOGLE_GENERATIVE_AI_API_KEY in .env")

    # The same file is often sent more than once (to the client, then forwarded with the approval).
    unique: dict[str, dict] = {}
    for line in Path(args.source).read_text().splitlines():
        record = json.loads(line)
        known = unique.get(record["sha1"])
        if known:
            known["emails"].append({k: record[k] for k in ("messageId", "date", "from", "to", "subject", "approval")})
            known["approval"] = known["approval"] or record["approval"]
            known["siblings"] += [s for s in record["siblings"] if s not in known["siblings"]]
            continue
        record["emails"] = [{k: record[k] for k in ("messageId", "date", "from", "to", "subject", "approval")}]
        unique[record["sha1"]] = record
    records = [record for record in unique.values() if record["text"].strip()]
    if args.limit:
        random.Random(7).shuffle(records)
        records = records[: args.limit]
    print(f"{len(records)} distinct proformas with text", file=sys.stderr)
    if args.dump:
        with open(args.dump, "w") as sink:
            for record in records:
                sink.write(json.dumps({"sha1": record["sha1"], "pi": record["pi"], "text": clean(record["text"])}, ensure_ascii=False) + "\n")
        return

    done = Path(args.out)
    finished = set()
    if done.exists():
        finished = {json.loads(line)["sha1"] for line in done.read_text().splitlines() if line.strip()}
    todo = [record for record in records if record["sha1"] not in finished]
    tokens = {"in": 0, "out": 0}

    def work(record):
        result, usage = ask(key, clean(record["text"]))
        return record, result, usage

    with open(done, "a") as sink, concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        for count, future in enumerate(concurrent.futures.as_completed([pool.submit(work, record) for record in todo]), 1):
            try:
                record, result, usage = future.result()
            except Exception as error:  # noqa: BLE001
                print(f"failed: {error}", file=sys.stderr)
                continue
            tokens["in"] += usage.get("promptTokenCount", 0)
            tokens["out"] += usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
            problems = check(result)
            row = {
                "sha1": record["sha1"],
                "pi": record["pi"],
                "filename": record["filename"],
                "pages": record["pages"],
                "approval": record["approval"],
                "emails": record["emails"],
                "siblings": record["siblings"],
                "body": record["body"][:600],
                "parsed": result,
                "problems": problems,
            }
            sink.write(json.dumps(row, ensure_ascii=False) + "\n")
            sink.flush()
            if count % 25 == 0:
                print(f"{count}/{len(todo)} · tokens in {tokens['in']:,} out {tokens['out']:,}", file=sys.stderr, flush=True)
    print(f"done · tokens in {tokens['in']:,} out {tokens['out']:,}", file=sys.stderr)


if __name__ == "__main__":
    main()
