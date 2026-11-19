#!/usr/bin/env python3
"""Check src/lib/systems/shop-list.ts against the shop's materials spreadsheet."""

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_XLSX = "/Users/tonyboutros/Downloads/Pro Ink List of Marerials   .xlsx"
LIST_PATH = Path(__file__).resolve().parents[1] / "src" / "lib" / "systems" / "shop-list.ts"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
# The shop's tools. They are not a cost of a job.
EXCLUDED = {
    121, 122, 123, 149, 150, 151, 152, 153, 154, 156, 157, 158, 159, 160,
    165, 166, 167, 168, 171, 173, 174, 175, 176, 177, 180, 181, 182, 183, 184,
}
FIRST_ROW = 6
LAST_ROW = 234
HALF_CENT = 0.5


def cents_apart(left: float, right: float) -> float:
    return abs(left - right) * 100


def column_row(ref: str) -> tuple[str, int] | None:
    match = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    if not match:
        return None
    return match.group(1), int(match.group(2))


def cell_text(cell: ET.Element, shared: list[str]) -> str | None:
    kind = cell.attrib.get("t")
    value = cell.find(f"{NS}v")
    if kind == "s" and value is not None and value.text:
        return shared[int(value.text)]
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{NS}t"))
    if value is not None and value.text:
        return value.text
    return None


def sheet_prices(path: Path) -> dict[int, float]:
    with zipfile.ZipFile(path) as book:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            for item in root.findall(f"{NS}si"):
                shared.append("".join(node.text or "" for node in item.iter(f"{NS}t")))
        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in book.namelist():
            sheets = [name for name in book.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)]
            if not sheets:
                raise SystemExit(f"No worksheet in {path}")
            sheet_name = sorted(sheets)[0]
        root = ET.fromstring(book.read(sheet_name))
    prices: dict[int, float] = {}
    for cell in root.iter(f"{NS}c"):
        ref = cell.attrib.get("r")
        parsed = column_row(ref) if ref else None
        if not parsed or parsed[0] != "D":
            continue
        row = parsed[1]
        if row < FIRST_ROW or row > LAST_ROW:
            continue
        text = cell_text(cell, shared)
        if text is None:
            continue
        cleaned = text.strip().replace(",", "")
        if not cleaned:
            continue
        try:
            prices[row] = float(cleaned)
        except ValueError:
            continue
    return prices


def list_prices(path: Path) -> list[tuple[int, float, str]]:
    text = path.read_text()
    board = re.compile(
        r"\bboard\(\s*(\d+)\s*,\s*\"([^\"]+)\"\s*,\s*\"[^\"]*\"\s*,\s*(?:null|\"[^\"]*\")\s*,\s*(-?\d+(?:\.\d+)?)"
    )
    item = re.compile(
        r"\bitem\(\s*(\d+)\s*,\s*\"([^\"]+)\"\s*,\s*\"[^\"]*\"\s*,\s*\"[^\"]*\"\s*,\s*\"[^\"]*\"\s*,\s*(-?\d+(?:\.\d+)?)"
    )
    found = [(int(row), float(price), name) for row, name, price in board.findall(text)]
    found += [(int(row), float(price), name) for row, name, price in item.findall(text)]
    return found


def main() -> int:
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_XLSX)
    sheet = sheet_prices(xlsx)
    listed = list_prices(LIST_PATH)
    errors: list[str] = []
    seen: dict[int, str] = {}
    for row, price, name in listed:
        if row in seen:
            errors.append(f"Row {row} is used twice ({seen[row]} and {name}).")
            continue
        seen[row] = name
        if row not in sheet:
            errors.append(f"Row {row} ({name}) is in the list, but column D has no price.")
            continue
        if cents_apart(price, sheet[row]) > HALF_CENT + 1e-6:
            errors.append(f"Row {row} ({name}): sheet says {sheet[row]}, list says {price}.")
    missing = []
    for row, price in sorted(sheet.items()):
        if row in seen or row in EXCLUDED:
            continue
        missing.append(f"Row {row} has price {price} and is neither in the list nor excluded.")
    errors.extend(missing)
    blank = LAST_ROW - FIRST_ROW + 1 - len(sheet)
    if errors:
        print(f"{len(errors)} mismatch(es) in {xlsx.name}:")
        for line in errors:
            print(f"- {line}")
        print(f"{len(listed)} list entries, {len(sheet)} priced rows, {len(EXCLUDED)} excluded, {blank} rows without a price.")
        return 1
    print(
        f"OK: {len(listed)} list prices match the spreadsheet, "
        f"{len(EXCLUDED)} tool rows excluded, {blank} rows without a price."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
