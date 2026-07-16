"""
Procedural city generator for GRAND THEFT AUDI — "Neustadt Bay".

Single source of truth for the city layout. Outputs a JSON document consumed by
the browser client (chunked world streaming, nav graph for traffic/police AI,
points of interest, races, stunt jumps). The client never re-implements this
logic — it only consumes the JSON.

Layout model
------------
- Square block grid, `BLOCKS` x `BLOCKS` cells of `BLOCK` metres, centred on origin.
- Roads run on the grid boundary lines (indices 0..BLOCKS inclusive).
- Districts (per cell): water marina strip (west), industrial docks, downtown
  core, commercial ring, residential ring, rural outskirts, scattered parks.
- A highway ring road separates the suburbs from the rural outskirts.

Usage:
    python -m worldgen.citygen --seed 1337 --out ../client/public/world/city.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

BLOCKS = 48          # city is BLOCKS x BLOCKS cells (2.88 km square)
BLOCK = 60.0         # metres per cell (48 m lot + 12 m road)
CHUNK_BLOCKS = 4     # 4x4 cells per streaming chunk -> 12x12 chunks
WORLD = BLOCKS * BLOCK
HALF = WORLD / 2.0
OFF = (BLOCKS - 32) // 2   # shift of the hand-authored urban core from the 32-block original

# district codes
WATER, DOWNTOWN, COMMERCIAL, RESIDENTIAL, INDUSTRIAL, RURAL, PARK, BEACH = 0, 1, 2, 3, 4, 5, 6, 7

# road types
T_STREET, T_AVENUE, T_HIGHWAY = 0, 1, 2
ROAD_SPEED = {T_STREET: 14.0, T_AVENUE: 22.0, T_HIGHWAY: 33.0}
ROAD_HALF = {T_STREET: 6.0, T_AVENUE: 7.0, T_HIGHWAY: 8.0}

HIGHWAY_LO, HIGHWAY_HI = 4 + OFF, 28 + OFF   # ring road (west leg doubles as the bayshore freeway)
AVENUE_LINES = (10 + OFF, 16 + OFF, 22 + OFF)

# building kinds
K_GENERIC, K_SHOP, K_BANK, K_POLICE, K_HOSPITAL, K_SAFEHOUSE, K_GARAGE, \
    K_GUNSHOP, K_SPRAY, K_WAREHOUSE, K_HOUSE, K_FARM = range(12)

# prop types
P_STREETLIGHT, P_TRAFFICLIGHT, P_TREE, P_HYDRANT, P_BENCH, P_CONTAINER, \
    P_CRANE, P_HAY, P_DUMPSTER, P_BILLBOARD, P_PARKMETER = range(11)


def line_pos(i: int) -> float:
    """World coordinate of grid boundary line `i` (0..BLOCKS)."""
    return -HALF + i * BLOCK


def cell_center(b: int) -> float:
    return -HALF + b * BLOCK + BLOCK / 2.0


# ---------------------------------------------------------------------------
# districts
# ---------------------------------------------------------------------------

def is_water_cell(bx: int, bz: int) -> bool:
    """West coastline with a large natural bay reaching the bayshore freeway."""
    if bx <= 1:
        return True
    # Neustadt Bay proper: wide ellipse whose rim kisses the ring road west leg
    ex = (bx + 0.5) / (HIGHWAY_LO - 0.5)
    ez = (bz + 0.5 - (16.0 + OFF)) / 7.5
    if ex * ex + ez * ez < 1.0:
        return True
    # a soft cove up north
    cx = (bx + 0.5) / 3.2
    cz = (bz + 0.5 - (3.0 + OFF)) / 2.6
    return cx * cx + cz * cz < 1.0


def build_districts(rng: random.Random) -> list[list[int]]:
    """district[bz][bx] -> code"""
    d = [[RURAL] * BLOCKS for _ in range(BLOCKS)]
    c = (BLOCKS - 1) / 2.0  # 15.5
    for bz in range(BLOCKS):
        for bx in range(BLOCKS):
            r = max(abs(bx - c), abs(bz - c))
            if is_water_cell(bx, bz):
                d[bz][bx] = WATER
            elif bx <= 9 and (5 + OFF <= bz <= 8 + OFF or 24 + OFF <= bz <= 27 + OFF):
                d[bz][bx] = INDUSTRIAL       # two harbor pockets around the bay
            elif r <= 3.5:
                d[bz][bx] = DOWNTOWN
            elif r <= 6.5:
                d[bz][bx] = COMMERCIAL
            elif r <= 10.5:
                d[bz][bx] = RESIDENTIAL
            else:
                d[bz][bx] = RURAL
    # beach: land cells hugging the water on the west side
    for bz in range(BLOCKS):
        for bx in range(BLOCKS):
            if d[bz][bx] in (WATER,):
                continue
            if bx > HIGHWAY_LO:
                continue
            neighbours = [(bx - 1, bz), (bx + 1, bz), (bx, bz - 1), (bx, bz + 1)]
            if any(0 <= nx < BLOCKS and 0 <= nz < BLOCKS and d[nz][nx] == WATER
                   for nx, nz in neighbours):
                if d[bz][bx] != INDUSTRIAL:
                    d[bz][bx] = BEACH
    # parks: central plaza + a few scattered greens (deterministic picks)
    d[16 + OFF][15 + OFF] = PARK
    park_candidates = [(9 + OFF, 10 + OFF), (21 + OFF, 20 + OFF),
                       (11 + OFF, 22 + OFF), (24 + OFF, 12 + OFF)]
    for bx, bz in park_candidates:
        if d[bz][bx] in (COMMERCIAL, RESIDENTIAL):
            d[bz][bx] = PARK
    return d


def district_at(d, bx, bz):
    if 0 <= bx < BLOCKS and 0 <= bz < BLOCKS:
        return d[bz][bx]
    return RURAL


# ---------------------------------------------------------------------------
# roads
# ---------------------------------------------------------------------------

def _seg_exists(d, axis: str, i: int, j: int) -> tuple[bool, int]:
    """Does road segment j -> j+1 exist on boundary line `i`? Returns (exists, type)."""
    # cells adjacent to the line, at segment row/col j
    if axis == "v":
        a = district_at(d, i - 1, j)
        b = district_at(d, i, j)
    else:
        a = district_at(d, j, i - 1)
        b = district_at(d, j, i)

    # highway ring
    if i in (HIGHWAY_LO, HIGHWAY_HI) and HIGHWAY_LO <= j < HIGHWAY_HI:
        if a == WATER and b == WATER:
            return False, T_STREET
        return True, T_HIGHWAY

    if a == WATER and b == WATER:
        return False, T_STREET
    if a == RURAL and b == RURAL:
        # sparse country roads
        return (i % 4 == 0), T_STREET

    t = T_AVENUE if i in AVENUE_LINES else T_STREET
    return True, t


def build_roads(d):
    """Merged road runs + per-segment map for nav graph."""
    runs = []
    seg = {"v": {}, "h": {}}  # seg[axis][(i, j)] = type
    for axis in ("v", "h"):
        for i in range(BLOCKS + 1):
            j = 0
            while j < BLOCKS:
                ok, t = _seg_exists(d, axis, i, j)
                if not ok:
                    j += 1
                    continue
                j0 = j
                while j < BLOCKS:
                    ok2, t2 = _seg_exists(d, axis, i, j)
                    if not ok2 or t2 != t:
                        break
                    seg[axis][(i, j)] = t
                    j += 1
                runs.append({"a": axis, "i": i, "j0": j0, "j1": j, "t": t})
    return runs, seg


def build_nav(seg):
    """Nav nodes at used intersections; edges per segment."""
    node_id = {}
    nodes = []

    def nid(i, j):
        key = (i, j)
        if key not in node_id:
            node_id[key] = len(nodes)
            nodes.append([round(line_pos(i), 2), round(line_pos(j), 2)])
        return node_id[key]

    edges = []
    for (i, j), t in seg["v"].items():   # vertical: x = line i, z from j to j+1
        edges.append([nid(i, j), nid(i, j + 1), t])
    for (i, j), t in seg["h"].items():   # horizontal: z = line i, x from j to j+1
        edges.append([nid(j, i), nid(j + 1, i), t])
    return nodes, edges


# ---------------------------------------------------------------------------
# buildings
# ---------------------------------------------------------------------------

# style indices are interpreted by the client's building factory (22 archetypes)
(S_GLASS_A, S_GLASS_B, S_GLASS_C, S_GLASS_D,
 S_OFFICE_A, S_OFFICE_B, S_OFFICE_C,
 S_BRICK_A, S_BRICK_B, S_BRICK_C,
 S_CONCRETE_A, S_CONCRETE_B, S_ARTDECO, S_SHOPFRONT,
 S_HOUSE_A, S_HOUSE_B, S_HOUSE_C, S_HOUSE_D,
 S_WAREHOUSE_A, S_WAREHOUSE_B, S_CIVIC, S_ROWHOUSE) = range(22)

GLASS = [S_GLASS_A, S_GLASS_B, S_GLASS_C, S_GLASS_D]
OFFICE = [S_OFFICE_A, S_OFFICE_B, S_OFFICE_C]
BRICK = [S_BRICK_A, S_BRICK_B, S_BRICK_C]
HOUSES = [S_HOUSE_A, S_HOUSE_B, S_HOUSE_C, S_HOUSE_D]

_SPECIALS_32 = {
    (17, 13): ("bank", K_BANK),
    (13, 17): ("police", K_POLICE),
    (22, 9):  ("police", K_POLICE),
    (19, 21): ("hospital", K_HOSPITAL),
    (23, 16): ("safehouse", K_SAFEHOUSE),
    (21, 16): ("garage", K_GARAGE),
    (12, 21): ("gunshop", K_GUNSHOP),
    (9, 12):  ("spray", K_SPRAY),
}
SPECIAL_BLOCKS = {(bx + OFF, bz + OFF): v for (bx, bz), v in _SPECIALS_32.items()}
SPECIAL_BLOCKS[(6, 14 + OFF)] = ("spray", K_SPRAY)   # docks spray shop by the north harbor

_SHOPS_32 = [
    (11, 14), (14, 11), (18, 10), (21, 13), (20, 19), (17, 22),
    (12, 18), (24, 18), (8, 16), (16, 25), (23, 21), (10, 20),
]
SHOP_BLOCKS = [(bx + OFF, bz + OFF) for bx, bz in _SHOPS_32]


def face_rotation(rng, bx, bz):
    """Rotation (quarter turns) so a building faces a road; block edges all have roads
    in urban areas, so pick deterministically-random among 4."""
    return rng.randrange(4)


def gen_block_buildings(rng, d, bx, bz, pois):
    """Returns (buildings, props) for one block. Building: [x,z,w,d,h,ry,style,kind]"""
    dist = d[bz][bx]
    if dist == WATER:
        return [], []
    cx, cz = cell_center(bx), cell_center(bz)
    buildings, props = [], []

    key = (bx, bz)
    special = SPECIAL_BLOCKS.get(key)
    is_shop_block = key in SHOP_BLOCKS

    def add(b_x, b_z, w, dd, h, ry, style, kind=K_GENERIC, tiers=None):
        entry = [round(b_x, 2), round(b_z, 2), round(w, 2), round(dd, 2),
                 round(h, 2), ry, style, kind]
        if tiers:
            entry.append([[round(a, 2), round(b, 2), round(c, 2)] for a, b, c in tiers])
        buildings.append(entry)
        return buildings[-1]

    def door_of(b):
        """Door world position on the front face given quarter-turn ry."""
        x, z, w, dd, h, ry = b[0], b[1], b[2], b[3], b[4], b[5]
        offs = [(0, dd / 2 + 1.5), (w / 2 + 1.5, 0), (0, -dd / 2 - 1.5), (-w / 2 - 1.5, 0)]
        ox, oz = offs[ry % 4]
        return [round(x + ox, 2), round(z + oz, 2)]

    if special:
        name, kind = special
        ry = face_rotation(rng, bx, bz)
        if kind == K_BANK:
            b = add(cx, cz, 30, 22, 20, ry, S_CIVIC, kind)
        elif kind == K_POLICE:
            b = add(cx, cz, 26, 20, 14, ry, S_CIVIC, kind)
        elif kind == K_HOSPITAL:
            b = add(cx, cz, 30, 24, 26, ry, S_CONCRETE_A, kind)
        elif kind == K_SAFEHOUSE:
            b = add(cx - 10, cz - 8, 12, 10, 7, ry, S_HOUSE_A, kind)
            add(cx + 12, cz + 10, 10, 8, 5, (ry + 2) % 4, S_HOUSE_B)
        elif kind == K_GARAGE:
            b = add(cx, cz, 26, 22, 9, ry, S_WAREHOUSE_A, kind)
        elif kind == K_GUNSHOP:
            b = add(cx - 8, cz, 14, 12, 8, ry, S_SHOPFRONT, kind)
            add(cx + 12, cz, 12, 12, 10, ry, rng.choice(BRICK))
        elif kind == K_SPRAY:
            b = add(cx, cz - 6, 16, 14, 7, ry, S_WAREHOUSE_B, kind)
        entry = {"pos": [round(b[0], 2), round(b[1], 2)], "door": door_of(b),
                 "ry": b[5], "block": [bx, bz]}
        pois.setdefault(name, []).append(entry)
        return buildings, props

    if dist == PARK:
        for _ in range(rng.randint(9, 15)):
            props.append([round(cx + rng.uniform(-20, 20), 2),
                          round(cz + rng.uniform(-20, 20), 2), P_TREE, 0])
        for _ in range(3):
            props.append([round(cx + rng.uniform(-16, 16), 2),
                          round(cz + rng.uniform(-16, 16), 2), P_BENCH,
                          rng.randrange(4)])
        return buildings, props

    if dist == DOWNTOWN:
        n = rng.randint(1, 2)

        def tower(px, pz, w, dd, h):
            # 60% of towers get art-deco style setbacks (stacked tiers)
            tiers = None
            if rng.random() < 0.6 and h > 45:
                if rng.random() < 0.5:
                    tiers = [(1, 1, 0.55), (0.74, 0.74, 0.3), (0.5, 0.5, 0.15)]
                else:
                    tiers = [(1, 1, 0.7), (0.62, 0.62, 0.3)]
            add(px, pz, w, dd, h, rng.randrange(4),
                rng.choice(GLASS + OFFICE + [S_ARTDECO, S_CONCRETE_B]), K_GENERIC, tiers)

        if n == 1:
            tower(cx, cz, rng.uniform(24, 34), rng.uniform(24, 34), rng.uniform(55, 135))
        else:
            tower(cx - 11, cz - 11, rng.uniform(16, 21), rng.uniform(16, 21), rng.uniform(45, 115))
            tower(cx + 11, cz + 11, rng.uniform(14, 20), rng.uniform(14, 20), rng.uniform(25, 65))
        if rng.random() < 0.3:
            props.append([round(cx + rng.uniform(-18, 18), 2),
                          round(cz + rng.uniform(-18, 18), 2), P_BILLBOARD, rng.randrange(4)])

    elif dist == COMMERCIAL:
        # sometimes a whole row-house strip instead of separate lots
        if rng.random() < 0.25 and not is_shop_block:
            ry = rng.choice([0, 1])
            add(cx, cz - 12, 40, 13, rng.uniform(10, 16), ry, S_ROWHOUSE)
            add(cx, cz + 12, 40, 13, rng.uniform(10, 16), ry, rng.choice(BRICK))
        else:
            cells = [(-12, -12), (12, -12), (-12, 12), (12, 12)]
            rng.shuffle(cells)
            n = rng.randint(3, 4)
            first = True
            for ox, oz in cells[:n]:
                style = rng.choice(BRICK + OFFICE + [S_CONCRETE_A, S_CONCRETE_B, S_ARTDECO, S_SHOPFRONT])
                kind = K_GENERIC
                if is_shop_block and first:
                    style, kind = S_SHOPFRONT, K_SHOP
                    first = False
                b = add(cx + ox + rng.uniform(-3, 3), cz + oz + rng.uniform(-3, 3),
                        rng.uniform(13, 19), rng.uniform(13, 19),
                        rng.uniform(8, 26), rng.randrange(4), style, kind)
                if kind == K_SHOP:
                    pois.setdefault("shops", []).append(
                        {"pos": [b[0], b[1]], "door": door_of(b), "ry": b[5], "block": [bx, bz]})
        if rng.random() < 0.5:
            props.append([round(cx + rng.uniform(-18, 18), 2),
                          round(cz + rng.uniform(-18, 18), 2), P_DUMPSTER, rng.randrange(4)])

    elif dist == RESIDENTIAL:
        cells = [(-15, -15), (0, -15), (15, -15), (-15, 15), (0, 15), (15, 15)]
        rng.shuffle(cells)
        n = rng.randint(3, 5)
        first = True
        for ox, oz in cells[:n]:
            kind = K_HOUSE
            style = rng.choice(HOUSES)
            if is_shop_block and first:
                style, kind = S_SHOPFRONT, K_SHOP
                first = False
            b = add(cx + ox + rng.uniform(-2, 2), cz + oz + rng.uniform(-2, 2),
                    rng.uniform(8, 12), rng.uniform(8, 11),
                    rng.uniform(4.5, 8), rng.randrange(4), style, kind)
            if kind == K_SHOP:
                pois.setdefault("shops", []).append(
                    {"pos": [b[0], b[1]], "door": door_of(b), "ry": b[5], "block": [bx, bz]})
        for _ in range(rng.randint(2, 5)):
            props.append([round(cx + rng.uniform(-20, 20), 2),
                          round(cz + rng.uniform(-20, 20), 2), P_TREE, 0])

    elif dist == INDUSTRIAL:
        n = rng.randint(1, 2)
        for k in range(n):
            ox = -10 if (n == 2 and k == 0) else (10 if n == 2 else 0)
            add(cx + ox, cz + rng.uniform(-6, 6),
                rng.uniform(18, 26), rng.uniform(14, 22),
                rng.uniform(8, 15), rng.randrange(4),
                rng.choice([S_WAREHOUSE_A, S_WAREHOUSE_B]), K_WAREHOUSE)
        for _ in range(rng.randint(2, 6)):
            props.append([round(cx + rng.uniform(-18, 18), 2),
                          round(cz + rng.uniform(-18, 18), 2), P_CONTAINER, rng.randrange(4)])
        if rng.random() < 0.25:
            props.append([round(cx + rng.uniform(-14, 14), 2),
                          round(cz + rng.uniform(-14, 14), 2), P_CRANE, rng.randrange(4)])

    elif dist == BEACH:
        # sand, palms, benches — the Strandpromenade
        for _ in range(rng.randint(4, 9)):
            props.append([round(cx + rng.uniform(-22, 22), 2),
                          round(cz + rng.uniform(-22, 22), 2), P_TREE, 0])
        for _ in range(rng.randint(1, 3)):
            props.append([round(cx + rng.uniform(-18, 18), 2),
                          round(cz + rng.uniform(-18, 18), 2), P_BENCH, rng.randrange(4)])
        if rng.random() < 0.2:
            add(cx + rng.uniform(-12, 12), cz + rng.uniform(-12, 12),
                rng.uniform(5, 7), rng.uniform(4, 6), 3.6,
                rng.randrange(4), S_HOUSE_C)  # beach kiosk hut

    elif dist == RURAL:
        if rng.random() < 0.22:
            add(cx + rng.uniform(-10, 10), cz + rng.uniform(-10, 10),
                rng.uniform(9, 13), rng.uniform(8, 11), rng.uniform(5, 7),
                rng.randrange(4), rng.choice([S_HOUSE_B, S_HOUSE_D]), K_FARM)
            if rng.random() < 0.6:
                add(cx + rng.uniform(-16, 16), cz + rng.uniform(-16, 16),
                    rng.uniform(10, 14), rng.uniform(8, 12), rng.uniform(6, 9),
                    rng.randrange(4), S_WAREHOUSE_A)
        for _ in range(rng.randint(1, 5)):
            props.append([round(cx + rng.uniform(-24, 24), 2),
                          round(cz + rng.uniform(-24, 24), 2),
                          rng.choice([P_TREE, P_TREE, P_HAY]), rng.randrange(4)])

    return buildings, props


# ---------------------------------------------------------------------------
# street furniture along roads
# ---------------------------------------------------------------------------

def gen_road_props(d, runs):
    """Streetlights along urban roads, traffic lights at avenue intersections."""
    props = []
    for r in runs:
        if r["t"] == T_HIGHWAY:
            spacing, offset = 45.0, ROAD_HALF[T_HIGHWAY] + 1.0
        else:
            spacing, offset = 30.0, ROAD_HALF[r["t"]] + 1.0
        z0, z1 = line_pos(r["j0"]), line_pos(r["j1"])
        fixed = line_pos(r["i"])
        # only light urban roads
        n = int((z1 - z0) / spacing)
        for k in range(1, n):
            p = z0 + k * spacing
            side = 1 if k % 2 == 0 else -1
            if r["a"] == "v":
                bx, bz = r["i"] - (0 if side > 0 else 1), int((p + HALF) // BLOCK)
                x, z, ry = fixed + side * offset, p, (1 if side > 0 else 3)
            else:
                bx, bz = int((p + HALF) // BLOCK), r["i"] - (0 if side > 0 else 1)
                x, z, ry = p, fixed + side * offset, (0 if side > 0 else 2)
            dist = district_at(d, min(max(bx, 0), BLOCKS - 1), min(max(bz, 0), BLOCKS - 1))
            if dist in (RURAL, WATER):
                continue
            props.append([round(x, 2), round(z, 2), P_STREETLIGHT, ry])
    # traffic lights at avenue x avenue intersections
    for i in AVENUE_LINES:
        for j in AVENUE_LINES:
            x, z = line_pos(i), line_pos(j)
            off = ROAD_HALF[T_AVENUE] + 0.8
            props.append([round(x + off, 2), round(z + off, 2), P_TRAFFICLIGHT, 0])
            props.append([round(x - off, 2), round(z - off, 2), P_TRAFFICLIGHT, 2])
    return props


# ---------------------------------------------------------------------------
# activities: races / stunt jumps
# ---------------------------------------------------------------------------

def node_xy(i, j):
    return [round(line_pos(i), 2), round(line_pos(j), 2)]


def build_activities(rng):
    o = OFF
    races = [
        {
            "id": "innenstadt",
            "name": "Innenstadt Circuit",
            "laps": 2,
            "entry": 200,
            "prize": 1500,
            "checkpoints": [
                node_xy(11 + o, 11 + o), node_xy(16 + o, 11 + o), node_xy(21 + o, 11 + o), node_xy(21 + o, 16 + o),
                node_xy(21 + o, 21 + o), node_xy(16 + o, 21 + o), node_xy(11 + o, 21 + o), node_xy(11 + o, 16 + o),
            ],
        },
        {
            "id": "harbor",
            "name": "Bayside Sprint",
            "laps": 1,
            "entry": 100,
            "prize": 900,
            "checkpoints": [
                node_xy(HIGHWAY_LO, 34), node_xy(HIGHWAY_LO, 30), node_xy(HIGHWAY_LO, 26),
                node_xy(HIGHWAY_LO, 22), node_xy(HIGHWAY_LO, 18), node_xy(HIGHWAY_LO, 14),
                node_xy(16, 14), node_xy(18, 16),
            ],
        },
        {
            "id": "landstrasse",
            "name": "Landstrasse GP",
            "laps": 1,
            "entry": 300,
            "prize": 2500,
            "checkpoints": [
                node_xy(16 + o, 4 + o), node_xy(22 + o, 4 + o), node_xy(28 + o, 8 + o), node_xy(28 + o, 16 + o),
                node_xy(28 + o, 24 + o), node_xy(22 + o, 28 + o), node_xy(16 + o, 28 + o), node_xy(10 + o, 28 + o),
                node_xy(4 + o, 24 + o), node_xy(8 + o, 16 + o), node_xy(10 + o, 10 + o), node_xy(10 + o, 4 + o),
            ],
        },
    ]
    # stunt ramps: [x, z, ry(quarter turns), reward]
    stunts = []
    spots = [(6 + o, 12 + o, 1), (6 + o, 20 + o, 1), (16 + o, 6 + o, 0), (26 + o, 10 + o, 3),
             (26 + o, 22 + o, 3), (12 + o, 26 + o, 2), (20 + o, 26 + o, 2), (10 + o, 8 + o, 0)]
    for i, j, ry in spots:
        x, z = line_pos(i), line_pos(j)
        stunts.append([round(x + 2.5, 2), round(z + 2.5, 2), ry, 250])
    return races, stunts


# ---------------------------------------------------------------------------
# main generation
# ---------------------------------------------------------------------------

def generate_city(seed: int = 1337) -> dict:
    rng = random.Random(seed)
    d = build_districts(rng)
    runs, seg = build_roads(d)
    nodes, edges = build_nav(seg)

    pois: dict = {}
    n_chunks = BLOCKS // CHUNK_BLOCKS
    chunks = [[{"cx": cx, "cz": cz, "b": [], "p": []}
               for cx in range(n_chunks)] for cz in range(n_chunks)]

    def chunk_of(x, z):
        cx = int(min(max((x + HALF) // (CHUNK_BLOCKS * BLOCK), 0), n_chunks - 1))
        cz = int(min(max((z + HALF) // (CHUNK_BLOCKS * BLOCK), 0), n_chunks - 1))
        return chunks[cz][cx]

    for bz in range(BLOCKS):
        for bx in range(BLOCKS):
            brng = random.Random((seed * 7919 + bx * 131 + bz) & 0x7FFFFFFF)
            bs, ps = gen_block_buildings(brng, d, bx, bz, pois)
            for b in bs:
                chunk_of(b[0], b[1])["b"].append(b)
            for p in ps:
                chunk_of(p[0], p[1])["p"].append(p)

    for p in gen_road_props(d, runs):
        chunk_of(p[0], p[1])["p"].append(p)

    races, stunts = build_activities(rng)

    safe = pois["safehouse"][0]
    pois_out = {
        "safehouse": safe,
        "garage": pois["garage"][0],
        "bank": pois["bank"][0],
        "police": pois["police"],
        "hospital": pois["hospital"][0],
        "gunshop": pois["gunshop"][0],
        "spray": pois["spray"],
        "shops": pois.get("shops", []),
        "races": races,
        "stunts": stunts,
        "theftDrop": {"pos": [round(line_pos(5) + 30, 2), round(line_pos(6 + OFF) + 30, 2)]},
        "deliveryDepot": {"pos": [round(line_pos(5) + 30, 2), round(line_pos(25 + OFF) + 30, 2)]},
        "spawn": {"pos": safe["door"]},
    }

    return {
        "meta": {
            "name": "Neustadt Bay",
            "seed": seed,
            "version": 1,
            "blocks": BLOCKS,
            "blockSize": BLOCK,
            "worldSize": WORLD,
            "chunkBlocks": CHUNK_BLOCKS,
            "chunkSize": CHUNK_BLOCKS * BLOCK,
            "roadHalf": {"0": ROAD_HALF[T_STREET], "1": ROAD_HALF[T_AVENUE], "2": ROAD_HALF[T_HIGHWAY]},
            "roadSpeed": {"0": ROAD_SPEED[T_STREET], "1": ROAD_SPEED[T_AVENUE], "2": ROAD_SPEED[T_HIGHWAY]},
        },
        "districts": d,
        "roads": runs,
        "nav": {"nodes": nodes, "edges": edges},
        "chunks": [c for row in chunks for c in row],
        "pois": pois_out,
    }


def _sanity(city: dict):
    """POIs must sit on land; the road graph must connect key POIs."""
    d = city["districts"]
    half = city["meta"]["worldSize"] / 2
    bs = city["meta"]["blockSize"]

    def cell(p):
        return d[min(max(int((p[1] + half) // bs), 0), BLOCKS - 1)][
            min(max(int((p[0] + half) // bs), 0), BLOCKS - 1)]

    keys = ["safehouse", "garage", "bank", "hospital", "gunshop", "theftDrop", "deliveryDepot"]
    for k in keys:
        p = city["pois"][k].get("door") or city["pois"][k]["pos"]
        assert cell(p) != WATER, f"POI {k} is underwater at {p}"

    # connectivity via BFS over nav edges
    nodes = city["nav"]["nodes"]
    adj: dict[int, list[int]] = {}
    for a, b, _t in city["nav"]["edges"]:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    def nearest(p):
        return min(range(len(nodes)), key=lambda i: (nodes[i][0] - p[0]) ** 2 + (nodes[i][1] - p[1]) ** 2)

    start = nearest(city["pois"]["safehouse"]["door"])
    seen = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for nb in adj.get(cur, []):
            if nb not in seen:
                seen.add(nb)
                stack.append(nb)
    for k in ["bank", "theftDrop", "deliveryDepot", "gunshop"]:
        p = city["pois"][k].get("door") or city["pois"][k]["pos"]
        assert nearest(p) in seen, f"POI {k} unreachable by road"
    # every race checkpoint on a reachable node
    for race in city["pois"]["races"]:
        for cp in race["checkpoints"]:
            assert nearest(cp) in seen, f"race {race['id']} checkpoint {cp} unreachable"


def main():
    ap = argparse.ArgumentParser(description="Neustadt Bay city generator")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--out", type=str, default=None)
    args = ap.parse_args()
    city = generate_city(args.seed)
    _sanity(city)
    text = json.dumps(city, separators=(",", ":"))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        n_b = sum(len(c["b"]) for c in city["chunks"])
        n_p = sum(len(c["p"]) for c in city["chunks"])
        print(f"wrote {out} ({len(text)//1024} KiB) — {n_b} buildings, {n_p} props, "
              f"{len(city['nav']['nodes'])} nav nodes, {len(city['nav']['edges'])} edges")
    else:
        print(text)


if __name__ == "__main__":
    main()
