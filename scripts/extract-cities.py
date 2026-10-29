#!/usr/bin/env python3
"""Reproducible UN WUP2025 F21 extraction. No network dependency for app startup.

The source snapshot and geographic review are checked in for reproducibility. This
script never substitutes remembered populations. Uses only Python standard library.
"""
import argparse
import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx"
SOURCE_NAME = "WUP2025-F21-DEGURBA-Cities_Pop.xlsx"
POPULATION_DEFINITION = "Population of harmonised DEGURBA cities at mid-year (1 July), converted from thousands to persons; not administrative city-proper or metropolitan population."
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_DECODED_BYTES = 512 * 1024 * 1024

# Membership is a product boundary, independently verified from the official EU
# country directory. UN M49 identifiers only map source rows to ISO country codes.
COUNTRY_POLICY = json.loads((ROOT / "data/eu-countries.json").read_text())
EU_COUNTRIES = COUNTRY_POLICY["m49_to_iso"]


def key(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def column_number(label):
    number = 0
    for char in label:
        number = number * 26 + ord(char) - 64
    return number - 1


def workbook_rows(path):
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Source exceeds the bounded download limit")
    with zipfile.ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > MAX_DECODED_BYTES:
            raise ValueError("Workbook decoded content exceeds the bounded limit")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            tree = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(item.itertext()) for item in tree.findall("s:si", NS)]
        sheets = sorted(name for name in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name))
        for sheet in sheets:
            rows = []
            with archive.open(sheet) as stream:
                for _, row in ET.iterparse(stream, events=("end",)):
                    if row.tag != "{" + NS["s"] + "}row":
                        continue
                    values = {}
                    for cell in row.findall("s:c", NS):
                        reference = cell.attrib.get("r", "")
                        match = re.match(r"([A-Z]+)", reference)
                        if not match:
                            continue
                        node = cell.find("s:v", NS)
                        value = node.text if node is not None else ""
                        if cell.attrib.get("t") == "s" and value:
                            value = strings[int(value)]
                        elif cell.attrib.get("t") == "inlineStr":
                            value = "".join(cell.find("s:is", NS).itertext())
                        values[column_number(match.group(1))] = value or ""
                    if values:
                        rows.append([values.get(index, "") for index in range(max(values) + 1)])
                    row.clear()
            yield sheet, rows


def identify_headers(rows):
    aliases = {
        "city_code": {"citycode", "urbancentrecode", "urbancenterid", "cityid"},
        "name": {"city", "cityname", "urbancentre", "urbancenter", "urbanagglomeration"},
        "country_code": {"countrycode", "countryorareacode", "locationcode", "m49code", "locid"},
        "latitude": {"latitude", "lat", "pwcentlatitude"},
        "longitude": {"longitude", "lon", "long", "pwcentlongitude"},
        "population": {"2025", "20250"},
    }
    for index, row in enumerate(rows[:35]):
        columns = {}
        for column, value in enumerate(row):
            for field, options in aliases.items():
                if key(value) in options:
                    columns[field] = column
        if len(columns) == len(aliases):
            return index, columns
    raise ValueError("Actual F21 headers could not be recognised. Run --inspect and adapt the documented header aliases to the source, never guess columns.")


def extract_rows(path):
    for _, rows in workbook_rows(path):
        try:
            header, columns = identify_headers(rows)
        except ValueError:
            continue
        extracted = []
        for row in rows[header + 1:]:
            if len(row) <= max(columns.values()):
                continue
            values = {field: row[index].strip() for field, index in columns.items()}
            if not re.fullmatch(r"\d+(?:\.0+)?", values["city_code"]):
                continue
            code = str(int(Decimal(values["country_code"]))).zfill(3)
            if code not in EU_COUNTRIES:
                continue
            # F21 includes cities crossing the 50,000 threshold after 2025. A blank
            # reference-year cell denotes no published 2025 estimate, not zero.
            if not values["population"]:
                continue
            population = int((Decimal(values["population"].replace(",", "")) * 1000).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            latitude, longitude = float(values["latitude"]), float(values["longitude"])
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180 or population <= 0:
                raise ValueError("Invalid actual source coordinates/population")
            extracted.append({"source_id": "un-wup2025-city:" + str(int(Decimal(values["city_code"]))),
                              "name": values["name"], "country_code": EU_COUNTRIES[code],
                              "latitude": latitude, "longitude": longitude, "population": population})
        if extracted:
            if len({city["source_id"] for city in extracted}) != len(extracted):
                raise ValueError("Repeated actual city identifiers in source")
            return extracted
    raise ValueError("No recognised F21 data sheet; use --inspect, check the actual source and document any parser update")


def rank_cities(rows, review):
    if review.get("geography_scope") != "EU":
        raise ValueError("The current geography policy must explicitly select EU countries")
    selection = review.get("selection", {})
    identifiers = selection.get("retained_source_ids", []) + selection.get("added_source_ids", [])
    if not identifiers or len(set(identifiers)) != len(identifiers):
        raise ValueError("The initial-city selection has missing or repeated stable source identifiers")
    by_id = {city["source_id"]: city for city in rows}
    if len(by_id) != len(rows):
        raise ValueError("Repeated actual source identifiers")
    missing = set(identifiers) - by_id.keys()
    if missing:
        raise ValueError("Selected cities are missing from the EU source rows: " + ", ".join(sorted(missing)))
    included = [by_id[identifier] for identifier in identifiers]
    if any(city["country_code"] not in COUNTRY_POLICY["member_country_codes"] for city in included):
        raise ValueError("A selected city is outside the European Union")
    return sorted(included, key=lambda city: (-city["population"], city["source_id"]))


def fetch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ValueError("Snapshot already exists; refusing to overwrite it")
    temporary = path.with_suffix(".download")
    try:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as response, temporary.open("xb") as output:
            if response.geturl() != SOURCE_URL:
                raise ValueError("Source redirected; review the official URL before downloading")
            copied = 0
            while block := response.read(65536):
                copied += len(block)
                if copied > MAX_SOURCE_BYTES:
                    raise ValueError("Source exceeds bounded download limit")
                output.write(block)
        if not zipfile.is_zipfile(temporary):
            raise ValueError("The actual download is not an XLSX archive")
        temporary.rename(path)
    finally:
        temporary.unlink(missing_ok=True)


def self_test():
    """Pure checks: temporary synthetic archives/arrays, never production seed data."""
    checks = 0
    assert column_number("A") == 0 and column_number("AA") == 26
    checks += 1
    rows = [{"source_id": f"synthetic:{index}", "name": f"Synthetic {index}", "country_code": "RO",
             "latitude": 50, "longitude": 0, "population": 1000 - index}
            for index in range(4)]
    review = {"geography_scope": "EU", "selection": {
        "retained_source_ids": ["synthetic:2", "synthetic:0"], "added_source_ids": ["synthetic:3"]}}
    result = rank_cities(rows, review)
    assert [city["source_id"] for city in result] == ["synthetic:0", "synthetic:2", "synthetic:3"]
    checks += 1
    for invalid in [
        {"geography_scope": "Europe", "selection": review["selection"]},
        {"geography_scope": "EU", "selection": {"retained_source_ids": ["synthetic:missing"]}},
        {"geography_scope": "EU", "selection": {"retained_source_ids": ["synthetic:0"], "added_source_ids": ["synthetic:0"]}},
    ]:
        try:
            rank_cities(rows, invalid)
        except ValueError:
            checks += 1
        else:
            raise AssertionError("Invalid city selection was accepted")
    try:
        rank_cities([{**city, "country_code": "GB"} for city in rows], review)
    except ValueError:
        checks += 1
    else:
        raise AssertionError("Non-EU selected cities were accepted")
    def test_row(index, values):
        return '<row r="' + str(index) + '">' + ''.join(
            '<c r="' + chr(65 + column) + str(index) + '" t="inlineStr"><is><t>' + value + '</t></is></c>'
            for column, value in enumerate(values)) + '</row>'
    xml = ('<worksheet xmlns="' + NS["s"] + '"><sheetData>' +
           test_row(1, ["City Code", "City", "Country Code", "Latitude", "Longitude", "2025"]) +
           test_row(2, ["123", "Synthetic Bucharest", "642", "44.4", "26.1", "1234.5678"]) +
           '</sheetData></worksheet>')
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "synthetic.xlsx"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", xml)
        parsed = extract_rows(path)
        assert parsed[0]["population"] == 1234568 and parsed[0]["country_code"] == "RO" and parsed[0]["source_id"] == "un-wup2025-city:123"
        checks += 1
        non_eu_city = test_row(3, ["124", "Synthetic London", "826", "51.5", "0", "99999"])
        eu_cyprus = test_row(4, ["125", "Synthetic Nicosia", "196", "35.1", "33.3", "100"])
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", xml.replace("</sheetData>", non_eu_city + eu_cyprus + "</sheetData>"))
        eligible = extract_rows(path)
        assert len(eligible) == 2 and eligible[1]["country_code"] == "CY"
        checks += 1
        actual_headers = xml.replace("City Code", "City_Code").replace("Country Code", "LocID").replace("<t>City</t>", "<t>City_Name</t>").replace("Latitude", "PWCent_Latitude").replace("Longitude", "PWCent_Longitude")
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", actual_headers)
        assert extract_rows(path) == parsed
        checks += 1
        future_city = test_row(3, ["124", "Synthetic future city", "642", "44.5", "26.2", ""])
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", actual_headers.replace("</sheetData>", future_city + "</sheetData>"))
        assert extract_rows(path) == parsed
        checks += 1
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", xml.replace('<t>44.4</t>', '<t>144.4</t>'))
        try:
            extract_rows(path)
        except ValueError:
            checks += 1
        else:
            raise AssertionError("Invalid source latitude was accepted")
    print(json.dumps({"checks_passed": checks, "fixtures": "synthetic temporary data only", "source_verified": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=ROOT / "data/snapshots" / SOURCE_NAME)
    parser.add_argument("--fetch", action="store_true", help="Download only the identified official source; never replace an existing snapshot")
    parser.add_argument("--inspect", action="store_true", help="Print first 30 rows in each sheet to confirm actual headers")
    parser.add_argument("--review", type=Path, default=ROOT / "data/geography-review.json")
    parser.add_argument("--retrieval-date", help="Actual YYYY-MM-DD snapshot retrieval date; required for existing snapshots")
    parser.add_argument("--self-test", action="store_true", help="Run pure extraction/ranking checks with synthetic temporary fixtures")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    fetched = False
    if args.fetch:
        fetch(args.source)
        fetched = True
    if args.inspect:
        for sheet, rows in workbook_rows(args.source):
            print(json.dumps({"sheet": sheet, "rows": rows[:30]}, ensure_ascii=False, indent=2))
        return
    if not args.retrieval_date and not fetched:
        raise ValueError("Supply the actual --retrieval-date for the existing snapshot")
    date = args.retrieval_date or dt.datetime.now(dt.timezone.utc).date().isoformat()
    dt.date.fromisoformat(date)
    review = json.loads(args.review.read_text())
    ranked = rank_cities(extract_rows(args.source), review)
    snapshot_dir = ROOT / "data/snapshots"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    target = snapshot_dir / SOURCE_NAME
    if args.source.resolve() != target.resolve():
        if target.exists() and target.read_bytes() != args.source.read_bytes():
            raise ValueError("Refusing to replace a different source snapshot")
        if not target.exists():
            shutil.copyfile(args.source, target)
    cities = []
    for rank, city in enumerate(ranked, 1):
        entry = city.copy()
        naming = review.get("romanian_names", {}).get(city["source_id"], {})
        entry.update(display_name=naming.get("display_name", city["name"]), aliases=naming.get("aliases", []),
                     population_year=2025, population_definition=POPULATION_DEFINITION,
                     source_url=SOURCE_URL, retrieval_date=date, rank=rank)
        cities.append(entry)
    manifest = {"status": "verified", "geography_scope": "EU", "country_policy": "data/eu-countries.json",
                "selection": review["selection"], "dataset": "United Nations World Urbanization Prospects 2025, F21 DEGURBA Cities Population",
                "reference_year": 2025, "population_definition": POPULATION_DEFINITION,
                "source_url": SOURCE_URL, "download_page": "https://population.un.org/wup/downloads?tab=Cities",
                "retrieval_date": date, "source_snapshot": str(target.relative_to(ROOT)),
                "source_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                "licence": "CC BY 3.0 IGO", "licence_url": "https://creativecommons.org/licenses/by/3.0/igo/",
                "attribution": "United Nations, Department of Economic and Social Affairs, Population Division (2025). World Urbanization Prospects: The 2025 Revision, Online Edition.",
                "cities": cities}
    (ROOT / "data/cities.manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "verified", "cities": len(cities), "source_sha256": manifest["source_sha256"]}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError) as error:
        print("City extraction BLOCKED: " + str(error), file=sys.stderr)
        sys.exit(1)
