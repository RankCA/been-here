#!/usr/bin/env python3
"""Build the offline data files for Been Here.

Writes js/data/countries.js (Natural Earth 1:50m country shapes) and
js/data/cities.js (GeoNames places with 15,000+ people).

Usage: python3 tools/build_data.py
Downloads are cached in tools/.cache.
"""
import io
import json
import math
import os
import ssl
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache")
OUT = os.path.join(ROOT, "js", "data")

NE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
          "master/geojson/ne_50m_admin_0_countries.geojson")
CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"

# UN member states plus the two observer states (Vatican City, Palestine).
UN = set("""
AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG
BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG
SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID
IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW
MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO
OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG
SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA
AE GB US UY UZ VU VE VN YE ZM ZW VA PS
""".split())

# Natural Earth files some islands under "Seven seas". Put them somewhere useful.
SEVEN_SEAS = {"IO": "Asia", "SH": "Africa", "GS": "Antarctica", "TF": "Antarctica",
              "HM": "Antarctica", "MU": "Africa", "SC": "Africa", "MV": "Asia"}

# Shorter display names than Natural Earth's abbreviations.
RENAME = {
    "United States of America": "United States",
    "Dem. Rep. Congo": "DR Congo",
    "Central African Rep.": "Central African Republic",
    "Dominican Rep.": "Dominican Republic",
    "Bosnia and Herz.": "Bosnia and Herzegovina",
    "Eq. Guinea": "Equatorial Guinea",
    "S. Sudan": "South Sudan",
    "Solomon Is.": "Solomon Islands",
    "Marshall Is.": "Marshall Islands",
    "N. Mariana Is.": "Northern Mariana Islands",
    "U.S. Virgin Is.": "US Virgin Islands",
    "British Virgin Is.": "British Virgin Islands",
    "Cayman Is.": "Cayman Islands",
    "Turks and Caicos Is.": "Turks and Caicos Islands",
    "Cook Is.": "Cook Islands",
    "Pitcairn Is.": "Pitcairn Islands",
    "Falkland Is.": "Falkland Islands",
    "Faeroe Is.": "Faroe Islands",
    "Fr. Polynesia": "French Polynesia",
    "Fr. S. Antarctic Lands": "French Southern Lands",
    "S. Geo. and the Is.": "South Georgia",
    "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
    "Heard I. and McDonald Is.": "Heard and McDonald Islands",
    "Indian Ocean Ter.": "Christmas and Cocos Islands",
    "Ashmore and Cartier Is.": "Ashmore and Cartier Islands",
    "Wallis and Futuna Is.": "Wallis and Futuna",
    "St. Pierre and Miquelon": "Saint Pierre and Miquelon",
    "St-Martin": "Saint Martin",
    "St-Barthélemy": "Saint Barthelemy",
    "St. Kitts and Nevis": "Saint Kitts and Nevis",
    "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
    "Antigua and Barb.": "Antigua and Barbuda",
    "São Tomé and Principe": "Sao Tome and Principe",
    "W. Sahara": "Western Sahara",
    "N. Cyprus": "Northern Cyprus",
    "Micronesia": "Micronesia",
    "eSwatini": "Eswatini",
    "Côte d'Ivoire": "Ivory Coast",
    "Curaçao": "Curacao",
    "Åland": "Aland Islands",
}

R_KM = 6371.0088
SCALE = 1000  # coordinates are stored as integer thousandths of a degree


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("downloading", url)
        ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem") if os.path.exists("/etc/ssl/cert.pem") else None
        with urllib.request.urlopen(url, context=ctx) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def ring_area_km2(ring):
    """Spherical area of a lon/lat ring."""
    total = 0.0
    n = len(ring)
    for i in range(n):
        lon1, lat1 = ring[i]
        lon2, lat2 = ring[(i + 1) % n]
        total += math.radians(lon2 - lon1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total) * R_KM * R_KM / 2


def simplify(points, tol):
    """Douglas-Peucker on a closed ring. Keeps at least 4 points."""
    if len(points) <= 5:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if L2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, idx = d, i
        if idx >= 0 and best > tol * tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    out = [p for p, k in zip(points, keep) if k]
    if len(out) < 4:
        return points
    return out


def encode_ring(ring):
    flat = []
    px = py = 0
    first = True
    for lon, lat in ring:
        x, y = round(lon * SCALE), round(lat * SCALE)
        if first:
            flat += [x, y]
            first = False
        elif x != px or y != py:
            flat += [x - px, y - py]
        else:
            continue
        px, py = x, y
    return flat


def build_countries():
    data = json.load(open(fetch(NE_URL, "ne50.geojson"), encoding="utf-8"))
    out = []
    total_area = 0.0
    verts = 0
    for f in data["features"]:
        p = f["properties"]
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        iso = p["ISO_A2_EH"] if p["ISO_A2_EH"] != "-99" else ""
        name = RENAME.get(p["NAME"], p["NAME"])
        cont = p["CONTINENT"]
        if cont.startswith("Seven seas"):
            cont = SEVEN_SEAS.get(iso, "Oceania")
        un = 1 if (iso in UN and p["TYPE"] != "Dependency") else 0
        area = 0.0
        enc = []
        for poly in polys:
            for i, ring in enumerate(poly):
                a = ring_area_km2(ring)
                area += a if i == 0 else -a
            rings = []
            for ring in poly:
                s = simplify(ring, 0.004)
                e = encode_ring(s)
                if len(e) >= 8:
                    rings.append(e)
                    verts += len(e) // 2
            if rings:
                enc.append(rings)
        total_area += area
        out.append([p["ADM0_A3"], name, iso, cont, un, round(area, 1), enc])
    out.sort(key=lambda r: r[1])
    ids = [r[0] for r in out]
    assert len(ids) == len(set(ids)), "country ids must be unique"
    js = ("// Generated by tools/build_data.py from Natural Earth 1:50m (public domain).\n"
          "// Row: [id, name, iso2, continent, isUNcountry, areaKm2, polygons]\n"
          "// Rings are delta-encoded integer thousandths of a degree [lng, lat].\n"
          "window.BH_COUNTRY_DATA = " + json.dumps({"scale": SCALE, "land": round(total_area), "list": out},
                                                  separators=(",", ":"), ensure_ascii=False) + ";\n")
    path = os.path.join(OUT, "countries.js")
    open(path, "w", encoding="utf-8").write(js)
    print("countries:", len(out), "features,", sum(r[4] for r in out), "UN,", verts, "vertices,",
          round(total_area), "km2,", len(js) // 1024, "KB")


def build_cities():
    zpath = fetch(CITIES_URL, "cities15000.zip")
    with zipfile.ZipFile(zpath) as z:
        text = z.read("cities15000.txt").decode("utf-8")
    skip = {"PPLH", "PPLQ", "PPLW", "PPLCH", "PPLF", "PPLR"}
    rows = []
    for line in text.splitlines():
        c = line.split("\t")
        if len(c) < 15 or c[7] in skip:
            continue
        kind = "c" if c[7] == "PPLC" else ("d" if c[7] == "PPLX" else "")
        name = c[1].replace("\t", " ").replace("\n", " ")
        rows.append((name, c[8], round(float(c[4]), 3), round(float(c[5]), 3), int(c[14] or 0), kind))
    rows.sort(key=lambda r: -r[4])
    body = "\n".join("%s\t%s\t%s\t%s\t%d\t%s" % r for r in rows)
    js = ("// Generated by tools/build_data.py from GeoNames cities15000 (CC BY 4.0).\n"
          "// Line: name, country, lat, lng, population, kind (c capital, d district)\n"
          "window.BH_CITY_DATA = " + json.dumps(body, ensure_ascii=False) + ";\n")
    path = os.path.join(OUT, "cities.js")
    open(path, "w", encoding="utf-8").write(js)
    print("cities:", len(rows), "places,", len(js) // 1024, "KB")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    build_countries()
    build_cities()
    sys.exit(0)
