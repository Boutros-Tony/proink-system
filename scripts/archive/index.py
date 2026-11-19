"""
Build a byte index of Mireille's inbox and sent mail.

The mailbox files are only read. Nothing in Thunderbird or on the mail server changes.
Messages flagged deleted, and messages dated before --since, are left out. The scan still
walks past them. Same folder and Message-ID keeps the later copy.

  python3 scripts/archive/index.py --since 2023-09-01 --out .archive/mail-index.jsonl
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from email.header import decode_header, make_header
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scan import header_value, parse_date

ROOT = Path.home() / "Library/Thunderbird/Profiles/9jrkmb69.default-release/ImapMail/outlook.office365.com"
FOLDERS = ("INBOX", "Sent Items")
SEPARATOR = b"From - "
NEEDLE = b"\nFrom - "
MAX_HEADER = 512 * 1024
ID_RE = re.compile(r"<[^>\s]+>")


def mailbox_path(folder: str) -> Path:
    return ROOT / folder


def decode_words(value: str) -> str:
    value = re.sub(r"\r?\n[\t ]+", " ", value).replace("\r", " ")
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return ""
    try:
        decoded = str(make_header(decode_header(value)))
    except Exception:
        return value
    return re.sub(r"\s+", " ", decoded).strip()


def message_ids(value: str) -> list[str]:
    found = []
    for item in ID_RE.findall(value or ""):
        if item not in found:
            found.append(item)
    return found


def deleted(headers: bytes) -> bool:
    status = header_value(headers, b"X-Mozilla-Status").strip().split()
    if not status:
        return False
    try:
        return bool(int(status[0], 16) & 0x0008)
    except ValueError:
        return False


def next_separator(handle) -> int | None:
    """Leave the handle on the next 'From - ' line. None means this message runs to EOF."""
    pos = handle.tell()
    peek = handle.read(len(SEPARATOR))
    if peek.startswith(SEPARATOR):
        handle.seek(pos)
        return pos
    handle.seek(pos)
    if not peek:
        return None
    overlap = b""
    while True:
        pos = handle.tell()
        chunk = handle.read(4 * 1024 * 1024)
        if not chunk:
            return None
        base = pos - len(overlap)
        data = overlap + chunk
        found = data.find(NEEDLE)
        if found != -1:
            start = base + found + 1
            handle.seek(start)
            return start
        overlap = data[-(len(NEEDLE) - 1) :]


def iter_messages(path: Path):
    """Yield (offset, length, header bytes) for every message. Offset is its 'From - ' line."""
    with open(path, "rb", buffering=8 * 1024 * 1024) as handle:
        while True:
            offset = handle.tell()
            line = handle.readline()
            if not line:
                return
            if not line.startswith(SEPARATOR):
                continue
            chunks = []
            size = 0
            end = handle.tell()
            while True:
                pos = handle.tell()
                line = handle.readline()
                if not line:
                    end = handle.tell()
                    break
                if line.startswith(SEPARATOR):
                    handle.seek(pos)
                    end = pos
                    break
                if line in (b"\n", b"\r\n") or size >= MAX_HEADER:
                    found = next_separator(handle)
                    end = handle.tell() if found is None else found
                    break
                chunks.append(line)
                size += len(line)
            yield offset, end - offset, b"".join(chunks)


def record_for(folder: str, offset: int, length: int, headers: bytes, since: datetime):
    if deleted(headers):
        return None
    sent = parse_date(decode_words(header_value(headers, b"Date")))
    if sent is not None and sent < since:
        return None
    message_id = message_ids(decode_words(header_value(headers, b"Message-ID")))
    reply = decode_words(header_value(headers, b"In-Reply-To"))
    reply_ids = message_ids(reply)
    return {
        "folder": folder,
        "offset": offset,
        "length": length,
        "messageId": message_id[0] if message_id else f"<noid-{folder}-{offset}>",
        "inReplyTo": " ".join(reply_ids) if reply_ids else reply,
        "references": message_ids(decode_words(header_value(headers, b"References"))),
        "date": sent.isoformat() if sent else None,
        "from": decode_words(header_value(headers, b"From")),
        "to": decode_words(header_value(headers, b"To")),
        "cc": decode_words(header_value(headers, b"Cc")),
        "subject": decode_words(header_value(headers, b"Subject")),
        "multipart": "multipart" in header_value(headers, b"Content-Type").lower(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    writing = out.with_name(out.name + ".writing")
    positions = {}
    scanned = {folder: 0 for folder in FOLDERS}
    started = time.time()
    with open(tmp, "wb") as sink:
        for folder in FOLDERS:
            for offset, length, headers in iter_messages(mailbox_path(folder)):
                scanned[folder] += 1
                if scanned[folder] % 20000 == 0:
                    print(f"{folder} {scanned[folder]} messages, {time.time() - started:.0f}s", file=sys.stderr, flush=True)
                record = record_for(folder, offset, length, headers, since)
                if record is None:
                    continue
                positions[(folder, record["messageId"])] = sink.tell()
                sink.write(json.dumps(record, ensure_ascii=False).encode("utf-8") + b"\n")
    winners = set(positions.values())
    kept = {folder: 0 for folder in FOLDERS}
    for folder, _message_id in positions:
        kept[folder] += 1
    with open(tmp, "rb") as src, open(writing, "wb") as dst:
        while True:
            pos = src.tell()
            line = src.readline()
            if not line:
                break
            if pos in winners:
                dst.write(line)
    tmp.unlink()
    writing.replace(out)
    elapsed = time.time() - started
    summary = ", ".join(f"{folder} {kept[folder]} kept of {scanned[folder]} scanned" for folder in FOLDERS)
    print(f"{summary}, {elapsed:.0f}s", file=sys.stderr)
    print(f"{summary}, {elapsed:.0f}s")


if __name__ == "__main__":
    main()
