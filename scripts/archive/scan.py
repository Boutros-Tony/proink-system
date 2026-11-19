"""
Find the proformas (PI files) in Mireille's Thunderbird inbox and pull out their text.

Reads the mailbox file only. Nothing in Thunderbird or on the mail server changes.
Only emails from the senders below, in the date range, are opened in full.

  python3 scripts/archive/scan.py --since 2025-01-01 --until 2026-01-01 --out .archive/pi-2025.jsonl
"""

import argparse
import email
import email.policy
import email.utils
import hashlib
import html
import json
import re
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

MAILBOX = Path.home() / "Library/Thunderbird/Profiles/9jrkmb69.default-release/ImapMail/outlook.office365.com/INBOX"
HELPER = Path(__file__).resolve().parents[2] / ".archive/bin/pdftext"
SENDERS = re.compile(rb"accounting@proink|hibal@proink-lb\.com|mireilles@proink-lb\.com", re.I)
PI_FILE = re.compile(r"^\s*PI\s*-?\s*(\d{4,})", re.I)
APPROVAL = re.compile(r"approv|signed|stamped|\bPO\b|purchase order|confirm", re.I)
SEPARATOR = b"From - "


def parse_date(value):
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def header_value(headers: bytes, name: bytes):
    match = re.search(rb"^" + name + rb":[ \t]*(.*(?:\r?\n[ \t].*)*)", headers, re.I | re.M)
    return match.group(1).decode("utf-8", "replace") if match else ""


def plain_text(message):
    body = message.get_body(("plain", "html"))
    if body is None:
        return ""
    try:
        content = body.get_content()
    except Exception:
        return ""
    if body.get_content_type() == "text/html":
        content = re.sub(r"(?is)<(style|script).*?</\1>", " ", content)
        content = html.unescape(re.sub(r"(?s)<[^>]+>", " ", content))
    return re.sub(r"\s+", " ", content).strip()


class PdfText:
    def __init__(self):
        self.process = subprocess.Popen([str(HELPER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(self, data: bytes):
        self.process.stdin.write(struct.pack(">I", len(data)) + data)
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        try:
            return json.loads(line)
        except Exception:
            return {"pages": 0, "text": ""}


def messages(path: Path):
    """Yield (headers, read_rest) for every message. read_rest returns the full message bytes."""
    with open(path, "rb", buffering=8 * 1024 * 1024) as handle:
        line = handle.readline()
        while line:
            if not line.startswith(SEPARATOR):
                line = handle.readline()
                continue
            header_lines = []
            line = handle.readline()
            while line and line not in (b"\n", b"\r\n") and not line.startswith(SEPARATOR):
                header_lines.append(line)
                line = handle.readline()
            headers = b"".join(header_lines)
            state = {"next": None}

            def read_rest(first=line):
                body = [first] if first else []
                current = handle.readline()
                while current and not current.startswith(SEPARATOR):
                    body.append(current)
                    current = handle.readline()
                state["next"] = current
                return headers + b"".join(body)

            yield headers, read_rest
            if state["next"] is not None:
                line = state["next"]
            else:
                line = handle.readline()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mailbox", default=str(MAILBOX))
    args = parser.parse_args()
    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    until = datetime.fromisoformat(args.until).replace(tzinfo=timezone.utc)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pdf = PdfText()
    seen: set[tuple[str, str]] = set()
    scanned = opened = found = 0
    started = time.time()
    with open(out, "w") as sink:
        for headers, read_rest in messages(Path(args.mailbox)):
            scanned += 1
            if scanned % 2000 == 0:
                print(f"{scanned} emails read, {opened} opened, {found} proformas, {time.time() - started:.0f}s", file=sys.stderr, flush=True)
            sender = header_value(headers, b"From").encode()
            if not SENDERS.search(sender):
                continue
            sent = parse_date(header_value(headers, b"Date"))
            if not sent or not (since <= sent < until):
                continue
            if not re.search(rb"multipart", headers, re.I):
                continue
            opened += 1
            message = email.message_from_bytes(read_rest(), policy=email.policy.default)
            attachments = []
            for part in message.walk():
                name = part.get_filename()
                if name and not part.is_multipart():
                    attachments.append((name, part))
            pis = [(name, part) for name, part in attachments if PI_FILE.match(name) and name.lower().endswith(".pdf")]
            if not pis:
                continue
            body = plain_text(message)
            siblings = [
                {"filename": name, "type": part.get_content_type(), "bytes": len(part.get_payload(decode=True) or b"")}
                for name, part in attachments
                if not (PI_FILE.match(name) and name.lower().endswith(".pdf")) and not name.lower().startswith("att0")
            ]
            for name, part in pis:
                data = part.get_payload(decode=True) or b""
                digest = hashlib.sha1(data).hexdigest()
                key = (digest, str(message["Message-ID"] or ""))
                if key in seen:
                    continue
                seen.add(key)
                text = pdf.read(data)
                found += 1
                record = {
                    "pi": "PI" + PI_FILE.match(name).group(1),
                    "filename": name,
                    "sha1": digest,
                    "pages": text.get("pages", 0),
                    "text": text.get("text", ""),
                    "messageId": str(message["Message-ID"] or ""),
                    "inReplyTo": str(message["In-Reply-To"] or ""),
                    "references": str(message["References"] or ""),
                    "date": sent.isoformat(),
                    "from": str(message["From"] or ""),
                    "to": str(message["To"] or ""),
                    "cc": str(message["Cc"] or ""),
                    "subject": str(message["Subject"] or ""),
                    "body": body[:2000],
                    "approval": bool(APPROVAL.search(str(message["Subject"] or "")) or APPROVAL.search(body[:1500])),
                    "otherProformas": len(pis) - 1,
                    "siblings": siblings,
                }
                sink.write(json.dumps(record, ensure_ascii=False) + "\n")
                sink.flush()
    print(f"done: {scanned} emails, {opened} opened, {found} proformas in {time.time() - started:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
