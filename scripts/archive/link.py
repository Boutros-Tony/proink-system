"""
Group the emails and files that belong to each proforma.

Reads the mail index and the mailbox files. Mailboxes are only read. A message is linked
when its subject covers the proforma title, it is on the strong anchor's thread, or it
carries this PI's number. Attachments are stored once under .archive/files and hard-linked
into the job folder. A file named decisions.json already in that folder is left in place.

  python3 scripts/archive/link.py --pis .archive/sample-20-low.jsonl --index .archive/mail-index.jsonl --out .archive/jobs
"""

import argparse
import email
import email.policy
import hashlib
import json
import os
import re
import shutil
import sys
import time
import unicodedata
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from index import mailbox_path
from scan import PI_FILE, PdfText

ID_RE = re.compile(r"<[^>\s]+>")
DOMAIN_RE = re.compile(r"@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
PI_REF = re.compile(r"pi\d+")
PI_NUM = re.compile(r"PI\s*-?(\d{4,})", re.I)
PREFIX_RE = re.compile(r"^(?:(?:re|fw|fwd|tr|aw)\s*:\s*)+", re.I)
TOKEN_RE = re.compile(r"[0-9A-Za-z]+")
DIM_RE = re.compile(r"\b\d{2,5}\s?(?:mm|cm)\b|\d{2,5}\s?[x×]\s?\d{2,5}", re.I)
IMAGE_JUNK = re.compile(r"^image\d+(?:\[\d+\])?\.(?:png|jpe?g|gif|bmp)$", re.I)
JUNK_RE = re.compile(r"^(?:att00.*|outlook-.*|logo.*|signature.*|winmail\.dat)$", re.I)
SIM_RE = re.compile(r"render|(?<![a-z0-9])3d(?![a-z0-9])|visual|simulation|(?<![a-z0-9])sim(?![a-z0-9])|mock-?up|mock\s+up|perspective|(?<![a-z0-9])view(?![a-z0-9])", re.I)
TECH_RE = re.compile(r"plan|elevation|technical|(?<![a-z0-9])tech(?![a-z0-9])|drawing|dwg|dxf|section|detail|dimension|(?<![a-z0-9])dim(?![a-z0-9])|shop\s*drawing|(?<![a-z0-9])cnc(?![a-z0-9])", re.I)
ART_RE = re.compile(r"artwork|print|(?<![a-z0-9])kv(?![a-z0-9])|key\s*visual|branding|sticker|logo\s*file", re.I)
FREE = ("gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com")
STOP = {
    "stand", "stands", "job", "jobs", "done", "proforma", "quotation", "quote", "invoice", "offer",
    "price", "prices", "with", "from", "your", "this", "that", "please", "find", "attached", "dear",
    "regards", "best", "thanks", "thank", "option", "options", "qty", "pcs", "stores", "store",
    "final", "revised", "new", "urgent", "and", "the", "for", "kindly", "also", "only", "send",
    "sent", "update", "updated",
}
GENERIC = {
    "installation", "install", "branding", "rebranding", "gondola", "gondolas", "stand", "stands",
    "sign", "signs", "signage", "shelf", "shelves", "shelving", "pillar", "pillars", "box", "boxes",
    "roll", "rollup", "relocation", "transportation", "transport", "delivery", "dressing", "display",
    "displays", "header", "counter", "kiosk", "podium", "visual", "visuals", "wall", "walls", "home",
    "brands", "brand", "pharmacy", "pharmacies", "store", "stores", "shop", "shops", "promoter",
    "maintenance", "removal", "fixing", "printing", "print", "sticker", "stickers", "frame", "frames",
    "light", "lighting", "led", "area", "corner", "end", "endcap", "cap", "floor", "window", "design",
    "3d", "render", "simulation", "technical", "drawing", "artwork", "offer", "proforma",
}
MONTHS = {
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december",
}
SIM_EXT = {".pptx", ".ppt", ".key"}
TECH_EXT = {".dwg", ".dxf", ".skp", ".3ds", ".obj", ".stl", ".step", ".stp"}
ART_EXT = {".ai", ".eps", ".psd", ".cdr", ".indd", ".svg"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".heic", ".heif"}
JUNK_EXT = {".ics", ".vcf", ".p7s", ".p7m", ".eml", ".msg"}
BIG_EXT = {".dwg", ".dxf", ".skp", ".pdf", ".ai", ".psd"}
PLACES = {"proforma": "proforma", "technical": "technical", "simulation": "simulations", "artwork": "artwork", "other": "other"}
RANK = {"anchor": 3, "high": 2, "medium": 1}
EARLY = datetime.min.replace(tzinfo=timezone.utc)
LATE = datetime.max.replace(tzinfo=timezone.utc)
SMALL_IMAGE = 40 * 1024
INLINE_IMAGE = 150 * 1024
SMALL_LIMIT = 25 * 1024 * 1024
LARGE_LIMIT = 80 * 1024 * 1024
PROBE = 600 * 1024
PROBE_WIDE = 8 * 1024 * 1024


def fold(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    return "".join(char for char in text if not unicodedata.combining(char))


def raw_tokens(value: str):
    text = fold(value or "").replace("'", "").replace("’", "").replace("`", "")
    return TOKEN_RE.findall(text)


def index_tokens(value: str) -> set[str]:
    return {raw.lower() for raw in raw_tokens(value) if len(raw) >= 3 and not raw.isdigit()}


def token_match(left: str, right: str) -> bool:
    if left == right:
        return True
    if len(left) >= 5 and len(right) >= 5 and abs(len(left) - len(right)) <= 2:
        return left.startswith(right) or right.startswith(left)
    return False


def matched_words(tokens, words: list[str]) -> list[str]:
    if not words:
        return []
    pool = list(tokens)
    return [word for word in words if any(token_match(token, word) for token in pool)]


def pi_numbers(value: str) -> set[str]:
    return {item.group(1) for item in PI_NUM.finditer(value or "")}


def other_pi(text: str, number: str) -> bool:
    numbers = pi_numbers(text)
    return bool(numbers) and number not in numbers


def clean_subject(value: str, number: str) -> str:
    text = value or ""
    previous = None
    while previous != text:
        previous = text
        text = PREFIX_RE.sub("", text).strip()
    text = PI_NUM.sub(" ", text)
    if number:
        text = re.sub(rf"(?<!\d){re.escape(number)}(?!\d)", " ", text)
    return text


def norm_subject(value: str) -> str:
    text = fold(clean_subject(value, "")).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def client_key(name: str) -> str:
    text = fold(name or "").replace("'", "").replace("’", "").replace("`", "").lower()
    return re.sub(r"\s+", " ", text).strip()


def usable(domain: str) -> bool:
    domain = domain.lower().rstrip(".")
    if "proink" in domain:
        return False
    return not any(domain == free or domain.endswith("." + free) for free in FREE)


def address_domains(*headers) -> list[str]:
    found = []
    seen = set()
    for header in headers:
        for domain in DOMAIN_RE.findall(header or ""):
            domain = domain.lower().rstrip(".")
            if domain not in seen:
                seen.add(domain)
                found.append(domain)
    return found


def parse_iso(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except Exception:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def sanitize(value: str) -> str:
    cleaned = [" " if char in "/:" or ord(char) < 32 or char == "\x7f" else char for char in value]
    return re.sub(r"\s+", " ", "".join(cleaned)).strip(" .")


def clean_filename(name: str) -> str:
    text = sanitize(name)
    if len(text) > 160:
        suffix = Path(text).suffix[:16]
        text = text[: 160 - len(suffix)].rstrip() + suffix
    return text or "attachment"


def file_ext(name: str) -> str:
    suffix = Path(name).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix or ""):
        return suffix
    return ""


def job_dirname(pi: str, client, title) -> str:
    name = sanitize(f"{pi} - {client or ''} - {title or ''}")
    name = re.sub(r"\s+", " ", name).strip()
    return (name[:90].rstrip() if len(name) > 90 else name) or pi or "job"


def prepare(folder: Path):
    """Remove a previous run. Unlink hard links only; the file store stays."""
    folder.mkdir(parents=True, exist_ok=True)
    for child in folder.iterdir():
        if child.name == "decisions.json" and child.is_file():
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def unique_path(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / filename
    number = 2
    while candidate.exists():
        candidate = directory / f"{Path(filename).stem} ({number}){Path(filename).suffix}"
        number += 1
    return candidate


def ids_of(rec) -> set[str]:
    cached = rec.get("_ids")
    if cached is None:
        cached = set()
        message_id = rec.get("messageId") or ""
        if message_id and not str(message_id).startswith("<noid-"):
            cached.add(message_id)
        cached.update(ID_RE.findall(rec.get("inReplyTo") or ""))
        for ref in rec.get("references") or []:
            cached.update(ID_RE.findall(ref or ""))
        rec["_ids"] = cached
    return cached


def pi_digits(pi: str) -> str:
    match = re.search(r"(\d{4,})", pi or "")
    return match.group(1) if match else ""


def this_pi_name(name: str, number: str) -> bool:
    match = PI_FILE.match(name or "")
    return bool(match and name.lower().endswith(".pdf") and match.group(1) == number)


def junk_name(name: str) -> bool:
    suffix = Path(name).suffix.lower()
    text = name.strip()
    return suffix in JUNK_EXT or bool(JUNK_RE.match(text) or IMAGE_JUNK.match(text))


def is_image(name: str, media: str) -> bool:
    return media.startswith("image/") or Path(name).suffix.lower() in IMAGE_EXT


def client_words_of(name: str) -> list[str]:
    found = []
    seen = set()
    for raw in raw_tokens(name or ""):
        if len(raw) < 3:
            continue
        if len(raw) == 3 and not (raw.isalpha() and raw.isupper()):
            continue
        folded = raw.lower()
        if folded in seen or folded.isdigit():
            continue
        seen.add(folded)
        found.append(folded)
    return found


def gather(value: str, banned: set[str], title: list[str], generic: list[str], title_seen: set[str], generic_seen: set[str]):
    for raw in raw_tokens(value):
        if len(raw) < 3:
            continue
        if len(raw) == 3 and not (raw.isalpha() and raw.isupper()):
            continue
        folded = raw.lower()
        if folded.isdigit() or PI_REF.fullmatch(folded):
            continue
        if folded in GENERIC or folded in MONTHS:
            if folded not in generic_seen:
                generic_seen.add(folded)
                generic.append(folded)
            continue
        if folded in STOP or folded in banned:
            continue
        if folded not in title_seen:
            title_seen.add(folded)
            title.append(folded)


class Reader:
    def __init__(self):
        self.handles = {}
        self.cache = {}

    def message(self, folder: str, offset: int, length: int):
        key = (folder, offset)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        handle = self.handles.get(folder)
        if handle is None:
            handle = open(mailbox_path(folder), "rb")
            self.handles[folder] = handle
        handle.seek(offset)
        data = handle.read(length)
        if data.startswith(b"From "):
            split = data.find(b"\n")
            data = data[split + 1 :] if split != -1 else data
        parsed = email.message_from_bytes(data, policy=email.policy.default)
        self.cache[key] = parsed
        return parsed

    def close(self):
        for handle in self.handles.values():
            handle.close()
        self.handles.clear()
        self.cache.clear()


class PdfKind:
    def __init__(self):
        self.helper = None

    def kind(self, data: bytes) -> str:
        if self.helper is None:
            self.helper = PdfText()
        try:
            text = self.helper.read(data).get("text") or ""
        except Exception:
            self.helper = None
            return "other"
        return "technical" if len(DIM_RE.findall(text)) >= 3 else "other"


def load_index(path: Path):
    rows = []
    by_id = defaultdict(list)
    counts = Counter()
    undated = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            rec = json.loads(line)
            rec["dt"] = parse_iso(rec.get("date"))
            if rec["dt"] is None:
                undated += 1
                continue
            rec["tokens"] = index_tokens(rec.get("subject") or "")
            rec["domains"] = address_domains(rec.get("from"), rec.get("to"), rec.get("cc"))
            ids_of(rec)
            for token in rec["tokens"]:
                counts[token] += 1
            rows.append(rec)
            by_id[rec["messageId"]].append(rec)
    rows.sort(key=lambda rec: rec["dt"])
    print(f"skipped {undated} undated", file=sys.stderr, flush=True)
    return rows, by_id, counts


def window_of(rows, start, end):
    lo = bisect_left(rows, start, key=lambda rec: rec["dt"])
    hi = bisect_right(rows, end, key=lambda rec: rec["dt"])
    return rows[lo:hi]


def find_anchors(pi_emails, by_id):
    found = []
    seen = set()
    missing = []
    for item in pi_emails or []:
        message_id = (item.get("messageId") or "").strip()
        hits = by_id.get(message_id)
        if not hits:
            missing.append(message_id)
            continue
        for hit in hits:
            key = (hit["folder"], hit["offset"])
            if key not in seen:
                seen.add(key)
                found.append(hit)
    return found, missing


def anchor_date(anchors, parsed, pi_emails):
    dates = [rec["dt"] for rec in anchors if rec.get("dt")]
    if not dates:
        for item in pi_emails or []:
            found = parse_iso(item.get("date"))
            if found:
                dates.append(found)
    if dates:
        return min(dates)
    fallback = parse_iso(parsed.get("date"))
    if fallback:
        return fallback
    try:
        return datetime.fromisoformat(parsed.get("date") or "").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def names_of(message) -> list[str]:
    names = []
    for part in message.walk():
        if part.is_multipart():
            continue
        name = part_name(part)
        if name and not junk_name(name):
            names.append(name)
    return names


def part_name(part) -> str:
    try:
        name = part.get_filename()
    except Exception:
        return ""
    return str(name).strip() if name else ""


def inline_image(part, name: str, media: str, size: int) -> bool:
    if not is_image(name, media) or size >= INLINE_IMAGE:
        return False
    try:
        disposition = part.get_content_disposition()
    except Exception:
        disposition = None
    if disposition == "inline":
        return True
    return bool(part.get("Content-ID") or part.get("Content-Id"))


def skip_reason(name: str, size: int):
    if size <= SMALL_LIMIT:
        return None
    suffix = Path(name).suffix.lower()
    if suffix in BIG_EXT and size <= LARGE_LIMIT:
        return None
    if size > LARGE_LIMIT:
        return f"over 80 MB ({size} bytes)"
    return f"over 25 MB ({size} bytes)"


def attachments_of(message, number: str, pi_sha: str, pdf: PdfKind):
    names = []
    files = []
    for part in message.walk():
        if part.is_multipart():
            continue
        name = part_name(part)
        if not name or junk_name(name):
            continue
        try:
            data = part.get_payload(decode=True) or b""
        except Exception:
            continue
        size = len(data)
        if size == 0:
            continue
        media = part.get_content_type() or "application/octet-stream"
        if inline_image(part, name, media, size) or (is_image(name, media) and size < SMALL_IMAGE):
            continue
        names.append(name)
        digest = hashlib.sha1(data).hexdigest()
        reason = skip_reason(name, size)
        if reason:
            files.append({"name": name, "sha1": digest, "bytes": size, "mediaType": media, "kind": "other", "data": None, "skipped": reason})
            continue
        if PI_FILE.match(name) and name.lower().endswith(".pdf") and not this_pi_name(name, number) and digest != pi_sha:
            continue
        kind = classify(name, data, media, number, digest, pi_sha, pdf)
        files.append({"name": name, "sha1": digest, "bytes": size, "mediaType": media, "kind": kind, "data": data, "skipped": None})
    return names, files


def classify(name, data, media, number, digest, pi_sha, pdf: PdfKind) -> str:
    if digest == pi_sha or this_pi_name(name, number):
        return "proforma"
    suffix = Path(name).suffix.lower()
    if SIM_RE.search(name) or suffix in SIM_EXT:
        return "simulation"
    if TECH_RE.search(name) or suffix in TECH_EXT:
        return "technical"
    if ART_RE.search(name) or suffix in ART_EXT:
        return "artwork"
    if suffix == ".pdf" or media == "application/pdf":
        return pdf.kind(data)
    return "other"


def place_for(kind: str, confidence: str) -> str:
    if kind == "proforma":
        return "proforma"
    if confidence == "medium":
        return "check"
    return PLACES.get(kind, "other")


def store_and_link(store: Path, digest: str, ext: str, data: bytes, directory: Path, filename: str) -> Path:
    folder = store / digest[:2]
    folder.mkdir(parents=True, exist_ok=True)
    kept = folder / f"{digest}{ext}"
    if not kept.exists():
        kept.write_bytes(data)
    dest = unique_path(directory, filename)
    os.link(kept, dest)
    return dest


def write_files(job: Path, store: Path, linked):
    linked = sorted(linked, key=lambda item: (-RANK[item["confidence"]], item["rec"].get("dt") or LATE))
    best = {}
    order = []
    for item in linked:
        for attachment in item["files"]:
            current = best.get(attachment["sha1"])
            if current is not None:
                if item["id"] not in current["emails"]:
                    current["emails"].append(item["id"])
                for reason in item["reasons"]:
                    if reason not in current["reasons"]:
                        current["reasons"].append(reason)
                continue
            entry = {
                "path": None,
                "name": attachment["name"],
                "kind": attachment["kind"],
                "confidence": item["confidence"],
                "sha1": attachment["sha1"],
                "bytes": attachment["bytes"],
                "mediaType": attachment["mediaType"],
                "emails": [item["id"]],
                "reasons": list(item["reasons"]),
                "skipped": attachment["skipped"],
            }
            if attachment["skipped"] is None and attachment["data"] is not None:
                folder = place_for(attachment["kind"], item["confidence"])
                path = store_and_link(store, attachment["sha1"], file_ext(attachment["name"]), attachment["data"], job / folder, clean_filename(attachment["name"]))
                entry["path"] = path.relative_to(job).as_posix()
            attachment["data"] = None
            best[attachment["sha1"]] = entry
            order.append(entry)
    return order


def render_emails(linked, files) -> str:
    lines = []
    ordered = sorted(linked, key=lambda item: item["rec"].get("dt") or EARLY)
    given = defaultdict(list)
    for entry in files:
        label = entry["path"] or f"{entry['name']} (skipped, {entry['bytes']} bytes)"
        for message_id in entry["emails"]:
            given[message_id].append(label)
    for item in ordered:
        rec = item["rec"]
        lines.append(f"{rec.get('date') or ''}  |  {rec.get('folder') or ''}  |  {item['confidence']}")
        lines.append(f"From: {rec.get('from') or ''}")
        lines.append(f"To: {rec.get('to') or ''}")
        if rec.get("cc"):
            lines.append(f"Cc: {rec.get('cc')}")
        lines.append(f"Subject: {rec.get('subject') or ''}")
        lines.append("Reasons: " + ("; ".join(item["reasons"]) or "none"))
        lines.append("Files: " + (", ".join(given.get(item["id"], [])) or "none"))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def coverage_tier(matched: list[str], total: int, client: bool, counts: Counter, lead_ok: bool = True):
    if total <= 0 or not matched:
        return None
    got = len(matched)
    # The lead word has to be in the subject. A file name must not supply it.
    if lead_ok and got == total and (total >= 2 or client):
        return "high"
    if total >= 2 and client and got * 3 >= total * 2:
        return "high" if lead_ok else "medium"
    if total == 1 and got == 1 and not client and counts.get(matched[0], 0) <= 30:
        return "medium"
    if total >= 2 and got * 2 >= total:
        return "medium"
    return None


def title_vocabulary(parsed, strong, number: str):
    banned = set(client_words_of(parsed.get("client") or ""))
    title, generic = [], []
    title_seen, generic_seen = set(), set()
    title_generic = []
    gather(parsed.get("title") or "", banned, title, title_generic, title_seen, set())
    for word in title_generic:
        if word not in generic_seen:
            generic_seen.add(word)
            generic.append(word)
    for rec in strong:
        gather(clean_subject(rec.get("subject") or "", number), banned, title, generic, title_seen, generic_seen)
    subject_links = bool(title)
    if not subject_links:
        title = list(title_generic)
    return title, generic, subject_links, banned


def strong_ones(anchors, number: str, title_words: list[str]):
    strong = []
    for rec in anchors:
        subject = rec.get("subject") or ""
        if number and number in pi_numbers(subject):
            strong.append(rec)
        elif title_words and matched_words(rec.get("tokens") or (), title_words):
            strong.append(rec)
    return strong


def thread_ids(seeds, window, number, strong_ids):
    found = set()
    for rec in seeds:
        found |= ids_of(rec)
    rounds = 2 if strong_ids else 1
    for _round in range(rounds):
        extra = set()
        for rec in window:
            ident = ids_of(rec)
            if not (ident & found):
                continue
            if other_pi(rec.get("subject") or "", number):
                continue
            extra |= ident
        if extra <= found:
            break
        found |= extra
    return found


def link_one(record, rows, by_id, counts: Counter, reader: Reader, pdf: PdfKind, siblings):
    parsed = record.get("parsed") or {}
    pi_emails = record.get("emails") or []
    anchors, missing = find_anchors(pi_emails, by_id)
    when = anchor_date(anchors, parsed, pi_emails)
    if when is None:
        return None, missing
    number = pi_digits(record.get("pi") or "")
    title_only, _, core_links, _ = title_vocabulary(parsed, [], number)
    if not core_links:
        title_only = []
    strong = strong_ones(anchors, number, title_only)
    title, generic, subject_links, banned = title_vocabulary(parsed, strong, number)
    base_title, _, _, _ = title_vocabulary(parsed, [], number)
    lead = base_title[0] if base_title else None
    mine = set(title)
    other_leads = []
    seen_leads = set()
    this_client = client_key(parsed.get("client"))
    for sib in siblings or []:
        word = sib.get("lead")
        if not this_client or sib.get("client") != this_client or sib.get("pi") == record.get("pi"):
            continue
        if word and word not in mine and word not in seen_leads:
            seen_leads.add(word)
            other_leads.append(word)
    start, end = when - timedelta(days=60), when + timedelta(days=30)
    window = window_of(rows, start, end)
    domains = set()
    for anchor in anchors:
        for domain in anchor.get("domains") or []:
            if usable(domain):
                domains.add(domain)
    domain_words = [word for word in banned if len(word) >= 4 and word not in STOP and word not in GENERIC]
    if domain_words:
        seen = set()
        for rec in window:
            for domain in rec["domains"]:
                if domain in seen:
                    continue
                seen.add(domain)
                if usable(domain) and any(word in domain for word in domain_words):
                    domains.add(domain)
    strong_ids = set()
    for rec in strong:
        strong_ids |= ids_of(rec)
    threads = thread_ids(strong or anchors, window, number, strong_ids if strong else set())
    anchor_keys = {(rec["folder"], rec["offset"]) for rec in anchors}
    anchor_ids = {rec.get("messageId") for rec in anchors}
    strong_keys = {(rec["folder"], rec["offset"]) for rec in strong}
    window_keys = {(rec["folder"], rec["offset"]) for rec in window}
    begun = time.time()
    pool = list(window)
    for anchor in anchors:
        key = (anchor["folder"], anchor["offset"])
        if key not in window_keys:
            pool.append(anchor)
    chosen = []
    rejected = []
    total = len(title) if subject_links else 0
    client_terms = [word for word in banned if word not in STOP]
    for rec in pool:
        if not rec.get("dt"):
            continue
        key = (rec["folder"], rec["offset"])
        subject = rec.get("subject") or ""
        tokens = rec.get("tokens") or set()
        ident = ids_of(rec)
        is_anchor = key in anchor_keys or rec.get("messageId") in anchor_ids
        matched_domains = [domain for domain in rec.get("domains") or [] if domain in domains]
        name_hits = matched_words(tokens, client_terms)
        client = bool(matched_domains or name_hits)
        this = bool(number) and number in pi_numbers(subject)
        blocked = other_pi(subject, number)
        direct = bool(ident & strong_ids)
        on_thread = bool(ident & threads)
        matched = matched_words(tokens, title) if subject_links else []
        generic_hits = matched_words(tokens, generic)
        own_lead = (not lead) or bool(matched_words(tokens, [lead]))
        foreign = bool(other_leads) and bool(matched_words(tokens, other_leads)) and not own_lead
        if is_anchor:
            confidence = "anchor"
        elif blocked and not direct:
            if matched or on_thread or this:
                rejected.append(rec)
            continue
        elif foreign and not this:
            continue
        elif blocked and direct:
            confidence = "medium"
        elif this or on_thread:
            confidence = "high"
        elif subject_links:
            confidence = coverage_tier(matched, total, client, counts, own_lead)
            if confidence is None:
                continue
        else:
            continue
        chosen.append({
            "rec": rec,
            "confidence": confidence,
            "matched": matched,
            "generic": generic_hits,
            "client": client,
            "domains": matched_domains,
            "name_hits": name_hits,
            "this": this,
            "thread": on_thread,
            "direct": direct,
            "blocked": blocked and not is_anchor,
            "anchor": is_anchor,
            "strong": key in strong_keys,
            "same_subject": False,
        })
    high_norms = set()
    for item in chosen:
        if item["confidence"] != "high":
            continue
        norm = norm_subject(item["rec"].get("subject") or "")
        if norm:
            high_norms.add(norm)
    chosen_keys = {(item["rec"]["folder"], item["rec"]["offset"]) for item in chosen}
    for rec in pool:
        if not rec.get("dt"):
            continue
        key = (rec["folder"], rec["offset"])
        if key in chosen_keys:
            continue
        subject = rec.get("subject") or ""
        norm = norm_subject(subject)
        if not norm or norm not in high_norms:
            continue
        tokens = rec.get("tokens") or set()
        ident = ids_of(rec)
        matched = matched_words(tokens, title) if subject_links else []
        own_lead = (not lead) or bool(matched_words(tokens, [lead]))
        if other_leads and matched_words(tokens, other_leads) and not own_lead:
            continue
        if other_pi(subject, number) and not (ident & strong_ids):
            continue
        on_thread = bool(ident & threads)
        matched_domains = [domain for domain in rec.get("domains") or [] if domain in domains]
        name_hits = matched_words(tokens, client_terms)
        chosen.append({
            "rec": rec,
            "confidence": "high" if on_thread else "medium",
            "matched": matched,
            "generic": matched_words(tokens, generic),
            "client": bool(matched_domains or name_hits),
            "domains": matched_domains,
            "name_hits": name_hits,
            "this": bool(number) and number in pi_numbers(subject),
            "thread": on_thread,
            "direct": bool(ident & strong_ids),
            "blocked": False,
            "anchor": False,
            "strong": False,
            "same_subject": True,
        })
        chosen_keys.add(key)
    scored = time.time() - begun
    sha = record.get("sha1") or ""

    def open_files(rec):
        if not (rec.get("multipart") and rec.get("offset") is not None):
            return [], []
        try:
            message = reader.message(rec["folder"], rec["offset"], rec["length"])
            return attachments_of(message, number, sha, pdf)
        except Exception:
            return [], []

    def take_files(item, names, files):
        item["files"] = files
        joined = " ".join(names)
        file_tokens = index_tokens(joined)
        file_this = bool(number) and number in pi_numbers(joined)
        file_blocked = other_pi(joined, number)
        saw_this = item["this"] or file_this
        if item["anchor"]:
            return
        if (item["blocked"] or file_blocked) and not saw_this:
            if item["direct"]:
                item["confidence"] = "medium"
                item["blocked"] = True
            else:
                item["drop"] = True
            return
        if file_this:
            item["confidence"] = "high"
            item["this"] = True
        if subject_links and not item["blocked"]:
            both = matched_words(set(item["rec"].get("tokens") or ()) | file_tokens, title)
            if both:
                item["matched"] = both
            lead_ok = (not lead) or (lead in matched_words(item["rec"].get("tokens") or (), title))
            if item["confidence"] != "high" and not (item.get("same_subject") and not item["thread"]):
                upgraded = coverage_tier(both, total, item["client"], counts, lead_ok)
                if upgraded == "high":
                    item["confidence"] = "high"
        extra_generic = matched_words(file_tokens, generic)
        if extra_generic:
            item["generic"] = list(dict.fromkeys([*item["generic"], *extra_generic]))

    for item in chosen:
        names, files = open_files(item["rec"])
        if names or files or item["rec"].get("multipart"):
            take_files(item, names, files)
    chosen_keys = {(item["rec"]["folder"], item["rec"]["offset"]) for item in chosen}
    for rec in window:
        key = (rec["folder"], rec["offset"])
        if key in chosen_keys or not rec.get("multipart"):
            continue
        length = rec.get("length") or 0
        if length > PROBE_WIDE:
            continue
        if length > PROBE and not (subject_links and matched_words(rec.get("tokens") or (), title)):
            continue
        try:
            message = reader.message(rec["folder"], rec["offset"], rec["length"])
            names = names_of(message)
        except Exception:
            continue
        if not number or number not in pi_numbers(" ".join(names)):
            continue
        try:
            names, files = attachments_of(message, number, sha, pdf)
        except Exception:
            names, files = [], []
        tokens = rec.get("tokens") or set()
        matched_domains = [domain for domain in rec.get("domains") or [] if domain in domains]
        item = {
            "rec": rec,
            "confidence": "high",
            "matched": matched_words(tokens, title) if subject_links else [],
            "generic": matched_words(tokens, generic),
            "client": bool(matched_domains or matched_words(tokens, client_terms)),
            "domains": matched_domains,
            "name_hits": matched_words(tokens, client_terms),
            "this": True,
            "thread": bool(ids_of(rec) & threads),
            "direct": bool(ids_of(rec) & strong_ids),
            "blocked": False,
            "anchor": False,
            "strong": False,
        }
        take_files(item, names, files)
        chosen.append(item)
        chosen_keys.add(key)
    saved = {(item["rec"]["folder"], item["rec"]["offset"]) for item in chosen if not item.get("drop")}
    other_count = sum(1 for rec in rejected if (rec["folder"], rec["offset"]) not in saved)
    other_count += sum(1 for item in chosen if item.get("drop"))
    linked = []
    for item in chosen:
        if item.get("drop"):
            continue
        reasons = []
        if item["anchor"]:
            reasons = ["strong anchor" if item["strong"] else "weak anchor"]
        elif item["blocked"] and item["confidence"] == "medium" and not item["this"]:
            reasons = ["same thread", "other proforma"]
        else:
            if item["this"]:
                reasons.append("this pi")
            if item["thread"]:
                reasons.append("same thread")
            if item.get("same_subject"):
                reasons.append("same subject")
            if item["matched"]:
                reasons.append("title words: " + ", ".join(item["matched"]))
            if item["generic"]:
                reasons.append("generic: " + ", ".join(item["generic"]))
            if item["domains"]:
                reasons.append("client domain " + ", ".join(dict.fromkeys(item["domains"])))
            if item["name_hits"]:
                reasons.append("client name in subject")
        linked.append({"id": item["rec"].get("messageId"), "rec": item["rec"], "confidence": item["confidence"], "reasons": reasons, "files": item.get("files") or []})
    print(
        f"{record.get('pi')} scored {len(window)} in {scored:.2f}s  lead={lead or '-'}  T={', '.join(title) or '-'}  "
        f"df={' '.join(f'{word}:{counts.get(word, 0)}' for word in title) or '-'}  "
        f"generic={', '.join(generic) or '-'}{'  no-subject' if not subject_links else ''}",
        file=sys.stderr,
        flush=True,
    )
    return {
        "pi": record.get("pi") or "",
        "client": parsed.get("client"),
        "title": parsed.get("title"),
        "date": parsed.get("date"),
        "dirname": job_dirname(record.get("pi") or "", parsed.get("client"), parsed.get("title")),
        "window": [start.isoformat(), end.isoformat()],
        "linked": linked,
        "keywords": {"title": title, "generic": generic},
        "other": other_count,
        "scored": scored,
    }, missing


def counts_for(linked, files):
    emails = {"anchor": 0, "high": 0, "medium": 0}
    for item in linked:
        emails[item["confidence"]] = emails.get(item["confidence"], 0) + 1
    kinds = {name: 0 for name in PLACES}
    check = 0
    for entry in files:
        if not entry["path"]:
            continue
        if entry["path"].startswith("check/"):
            check += 1
        elif entry["kind"] in kinds:
            kinds[entry["kind"]] += 1
    return emails, kinds, check


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pis", required=True)
    parser.add_argument("--index", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    started = time.time()
    print("loading index", file=sys.stderr, flush=True)
    rows, by_id, counts = load_index(Path(args.index))
    print(f"{len(rows)} index rows, {time.time() - started:.0f}s", file=sys.stderr, flush=True)
    root = Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    store = root.parent / "files"
    store.mkdir(parents=True, exist_ok=True)
    reader = Reader()
    pdf = PdfKind()
    table = []
    try:
        with open(args.pis, encoding="utf-8") as handle:
            records = [json.loads(line) for line in handle if line.strip()]
        siblings = []
        for record in records:
            parsed = record.get("parsed") or {}
            words, _, _, _ = title_vocabulary(parsed, [], pi_digits(record.get("pi") or ""))
            siblings.append({"pi": record.get("pi"), "client": client_key(parsed.get("client")), "lead": words[0] if words else None})
        for record in records:
            begun = time.time()
            built, missing = link_one(record, rows, by_id, counts, reader, pdf, siblings)
            if built is None:
                print(f"{record.get('pi')} skipped, no anchor date", file=sys.stderr, flush=True)
                continue
            if missing:
                print(f"{built['pi']} missing anchors: {len(missing)}", file=sys.stderr, flush=True)
            job = root / built["dirname"]
            prepare(job)
            files = write_files(job, store, built["linked"])
            manifest = {
                "pi": built["pi"],
                "client": built["client"],
                "title": built["title"],
                "date": built["date"],
                "folder": built["dirname"],
                "window": built["window"],
                "keywords": built["keywords"],
                "emails": [
                    {
                        "id": item["id"],
                        "mailbox": item["rec"].get("folder"),
                        "date": item["rec"].get("date"),
                        "from": item["rec"].get("from") or "",
                        "to": item["rec"].get("to") or "",
                        "subject": item["rec"].get("subject") or "",
                        "confidence": item["confidence"],
                        "reasons": item["reasons"],
                    }
                    for item in sorted(built["linked"], key=lambda item: item["rec"].get("dt") or EARLY)
                ],
                "files": files,
            }
            (job / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (job / "emails.md").write_text(render_emails(built["linked"], files), encoding="utf-8")
            emails, kinds, check = counts_for(built["linked"], files)
            table.append((built["pi"], emails, kinds, check))
            print(
                f"{built['pi']} emails {emails['high']}/{emails['medium']} anchors {emails['anchor']} "
                f"files {sum(kinds.values())} check {check} other-pi {built['other']} {time.time() - begun:.0f}s",
                file=sys.stderr,
                flush=True,
            )
    finally:
        reader.close()
    header = f"{'PI':<12} {'high':>5} {'med':>5} {'anchor':>6} {'proforma':>9} {'technical':>10} {'sim':>5} {'artwork':>8} {'other':>6} {'check':>6}"
    print(header)
    print("-" * len(header))
    for pi, emails, kinds, check in table:
        print(
            f"{pi:<12} {emails['high']:>5} {emails['medium']:>5} {emails['anchor']:>6} "
            f"{kinds['proforma']:>9} {kinds['technical']:>10} {kinds['simulation']:>5} "
            f"{kinds['artwork']:>8} {kinds['other']:>6} {check:>6}"
        )
    print(f"{len(table)} jobs, {time.time() - started:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
