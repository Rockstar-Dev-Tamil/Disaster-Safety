"""
Convert the supplied Kerala district KMZ hazard sheets to GeoJSON.

Kept as a script rather than a one-off so the remaining 12 districts can be
converted with the same command when the scope widens beyond Wayanad.

Class and attribute values are carried through VERBATIM from the source. They
are not remapped onto this application's 5-band ramp here -- that mapping is
made explicit in the layer registry, where it can be read and argued with.
"""
import json, re, sys, zipfile, os


def rdp(pts, eps):
    """Douglas-Peucker. Simplification never drops a feature: rings that would
    collapse below 4 points are returned at full detail instead."""
    if len(pts) < 3:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    imax, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if den == 0:
            d = (px - ax) ** 2 + (py - ay) ** 2
        else:
            t = ((px - ax) * dx + (py - ay) * dy) / den
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            qx, qy = ax + t * dx, ay + t * dy
            d = (px - qx) ** 2 + (py - qy) ** 2
        if d > dmax:
            imax, dmax = i, d
    if dmax > eps * eps:
        return rdp(pts[:imax + 1], eps)[:-1] + rdp(pts[imax:], eps)
    return [pts[0], pts[-1]]


def simplify_ring(ring, eps):
    if eps <= 0 or len(ring) <= 5:
        return ring
    out = rdp(ring[:-1], eps)
    if len(out) < 4:
        return ring                      # would collapse -- keep it intact
    if out[0] != out[-1]:
        out.append(out[0])
    return out

def parse_coords(text, dp):
    ring, seen = [], None
    for tok in text.split():
        p = tok.split(',')
        if len(p) < 2:
            continue
        try:
            xy = [round(float(p[0]), dp), round(float(p[1]), dp)]
        except ValueError:
            continue
        if xy != seen:          # drop consecutive duplicates
            ring.append(xy)
            seen = xy
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0])    # GeoJSON rings must close
    return ring if len(ring) >= 4 else None

def parse_polygon(block, dp, eps=0.0):
    rings = []
    outer = re.search(r'<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>.*?</outerBoundaryIs>', block, re.S)
    if not outer:
        return None
    r = parse_coords(outer.group(1), dp)
    if not r:
        return None
    rings.append(simplify_ring(r, eps))
    for inner in re.findall(r'<innerBoundaryIs>.*?<coordinates>(.*?)</coordinates>.*?</innerBoundaryIs>', block, re.S):
        h = parse_coords(inner, dp)
        if h:
            rings.append(simplify_ring(h, eps))
    return rings

def parse_description(pm):
    """Pull the attribute table out of the CDATA description.

    The attribute rows live in a table nested inside an outer wrapper table,
    which defeats row-wise scanning: the outer <tr> appears to close at the
    inner table's first </tr>. Isolate the innermost table first -- its <td>
    cells are then all leaves and pair off cleanly two at a time.
    """
    m = re.search(r'<description>\s*<!\[CDATA\[(.*?)\]\]>\s*</description>', pm, re.S)
    if not m:
        return {}
    html = m.group(1)
    i = html.rfind('<table')
    if i == -1:
        return {}
    j = html.find('</table>', i)
    inner = html[i:j if j != -1 else len(html)]
    cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', c)).strip()
             for c in re.findall(r'<td[^>]*>(.*?)</td>', inner, re.S)]
    return {cells[n]: cells[n + 1]
            for n in range(0, len(cells) - 1, 2) if cells[n]}

def convert(kmz, dp, eps=0.0):
    z = zipfile.ZipFile(kmz)
    kml = z.read('doc.kml').decode('utf-8', 'replace')
    feats = []
    for pm in re.findall(r'<Placemark\b.*?</Placemark>', kml, re.S):
        nm = re.search(r'<name>(.*?)</name>', pm, re.S)
        cls = nm.group(1).strip() if nm else 'Unclassified'
        polys = [p for p in (parse_polygon(b, dp, eps)
                             for b in re.findall(r'<Polygon\b.*?</Polygon>', pm, re.S)) if p]
        if not polys:
            continue
        geom = ({'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1
                else {'type': 'MultiPolygon', 'coordinates': [[r for r in p] for p in polys]})
        attrs = parse_description(pm)
        props = {'class': cls}
        for src, dst in (('FID', 'fid'), ('ZONE_', 'zone'), ('Land_form', 'landform'),
                         ('SHAPE_Area', 'shapeArea'), ('aarea', 'area')):
            if src in attrs:
                props[dst] = attrs[src]
        feats.append({'type': 'Feature', 'properties': props, 'geometry': geom})
    return {'type': 'FeatureCollection', 'features': feats}

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    dp = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    eps = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    fc = convert(src, dp, eps)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'))
    counts = {}
    for ft in fc['features']:
        counts[ft['properties']['class']] = counts.get(ft['properties']['class'], 0) + 1
    print(f"{os.path.basename(dst):34} {len(fc['features']):>4} features  "
          f"{os.path.getsize(dst)/1024:>8.0f} KB  {counts}")
