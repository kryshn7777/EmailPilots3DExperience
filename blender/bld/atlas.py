"""Atlas layouts: one shared texture sheet per building set.

A set is every module that can stand in the same scene, so one sheet means one
material, and the runtime streams four textures for the whole district while
every instanced module shares them.

  city   2048 px: eight 512x768 tiles for towers, four 512x448 tiles for the
         mid-rise blocks, a 64 px strip of flat-colour cells along the bottom.
  homes  1024 px: twelve 256x256 tiles for houses, four 256x224 for trees and
         outbuildings, a 32 px colour strip.

Texel density is not uniform across modules on purpose. The site rescales every
module so its largest dimension is the same on screen, so what matters is
pixels per *fraction of the building*, and a 30 m block needs far more pixels
per metre than a 220 m tower to look equally sharp. Each module solves for the
largest density that packs into its own tile.
"""
import math


class Layout:
    def __init__(self, name, size, tiles, palette_origin, pitch, cols, pad, gutter, margin,
                 reach):
        self.name, self.size = name, size
        self.tiles = tiles                     # kind -> [(x, y, w, h)]
        self.palette_origin, self.pitch, self.cols = palette_origin, pitch, cols
        self.pad, self.gutter, self.margin = pad, gutter, margin
        # (cage extrusion, max ray distance) in metres per bake group: walls reach
        # out to balconies and cornices, roofs reach up to plant and chimneys,
        # and neither may reach the next setback
        self.reach = reach

    def tile_rect(self, kind, index):
        return self.tiles[kind][index]

    def palette_cells(self, names):
        """Centre pixel (x, y) of each solid-colour cell, by sorted material name."""
        ox, oy = self.palette_origin
        return {name: (ox + self.pitch * (i % self.cols) + self.pitch // 2,
                       oy + self.pitch * (i // self.cols) + self.pitch // 2)
                for i, name in enumerate(sorted(names))}

    def layout_tile(self, slots, tile):
        """Largest density (px per metre) at which every slot packs into `tile`.

        Returns ({slot: (x, y, w_px, h_px)}, density) in atlas pixels, top-left origin.
        """
        tx, ty, tw, th = tile
        g = self.gutter
        W, H = tw - 2 * self.pad + g, th - 2 * self.pad + g
        items = [(k, s) for k, s in slots.items() if s['kind'] != 'solid']
        lo, hi, best = 0.3, 40.0, None
        for _ in range(26):
            d = (lo + hi) / 2
            rects = [(k, math.ceil(s['w'] * d) + g, math.ceil(s['h'] * d) + g) for k, s in items]
            packed = _maxrects(rects, W, H)
            if packed:
                lo, best = d, (d, rects, packed)
            else:
                hi = d
        if not best:
            raise ValueError('nothing fits in the tile')
        d, rects, packed = best
        out = {}
        for key, w, h in rects:
            x, y = packed[key]
            out[key] = (tx + self.pad + x, ty + self.pad + y, w - g, h - g)
        return out, d


def _contains(a, b):
    return a[0] <= b[0] and a[1] <= b[1] and a[0] + a[2] >= b[0] + b[2] and a[1] + a[3] >= b[1] + b[3]


def _maxrects(rects, W, H):
    """MaxRects best-short-side-fit. rects = [(key, w, h)]; None if they do not fit."""
    free = [(0, 0, W, H)]
    out = {}
    for key, w, h in sorted(rects, key=lambda r: (-max(r[1], r[2]), -r[1] * r[2])):
        best, best_score = None, None
        for fx, fy, fw, fh in free:
            if w <= fw and h <= fh:
                score = (min(fw - w, fh - h), max(fw - w, fh - h))
                if best_score is None or score < best_score:
                    best, best_score = (fx, fy), score
        if best is None:
            return None
        x, y = best
        out[key] = (x, y)
        split = []
        for fx, fy, fw, fh in free:
            if x >= fx + fw or x + w <= fx or y >= fy + fh or y + h <= fy:
                split.append((fx, fy, fw, fh))
                continue
            if x > fx:
                split.append((fx, fy, x - fx, fh))
            if x + w < fx + fw:
                split.append((x + w, fy, fx + fw - x - w, fh))
            if y > fy:
                split.append((fx, fy, fw, y - fy))
            if y + h < fy + fh:
                split.append((fx, y + h, fw, fy + fh - y - h))
        free = [r for i, r in enumerate(split)
                if not any(j != i and _contains(split[j], r) for j in range(len(split)))]
    return out


CITY = Layout(
    'city', 2048,
    tiles={
        'tower': [(512 * c, 768 * r, 512, 768) for r in range(2) for c in range(4)],
        'block': [(512 * c, 1536, 512, 448) for c in range(4)],
    },
    palette_origin=(1024, 1984), pitch=32, cols=32, pad=8, gutter=14, margin=8,
    reach={'wall': (1.8, 3.6), 'roof': (3.6, 6.0)},
)

HOMES = Layout(
    'homes', 1024,
    tiles={
        'house': [(256 * c, 256 * r, 256, 256) for r in range(3) for c in range(4)],
        'tree': [(256 * c, 768, 256, 224) for c in range(4)],
    },
    palette_origin=(0, 992), pitch=16, cols=64, pad=6, gutter=12, margin=6,
    reach={'wall': (1.2, 2.6), 'roof': (2.6, 5.0)},
)

LAYOUTS = {'city': CITY, 'homes': HOMES}


# Hero trees: a fixed sheet, not a packed one. Eight 512 px leaf-cluster cards in
# the top half, four 512x1024 bark strips (one per species) in the bottom half.
HERO_TREES = Layout(
    'hero-trees', 2048, tiles={}, palette_origin=(0, 0), pitch=1, cols=1, pad=0, gutter=0,
    margin=0, reach={},
)
_SPECIES = ['oak', 'maple', 'poplar', 'pine']
HERO_TREES.cards = {(sp, v): (512 * ((i * 2 + v) % 4), 512 * ((i * 2 + v) // 4), 512, 512)
                    for i, sp in enumerate(_SPECIES) for v in (0, 1)}
HERO_TREES.bark = {sp: (512 * i, 1024, 512, 1024) for i, sp in enumerate(_SPECIES)}

LAYOUTS['hero-trees'] = HERO_TREES


# Hero houses: the same twelve slots packed at twice the density. 512 px tiles give
# ~25 px per metre against the lean sheet's ~12, which is what a close-up needs from
# the siding, brick and window panes the geometry does not carry.
HOMES_HERO = Layout(
    'homes-hero', 2048,
    tiles={'house': [(512 * c, 512 * r, 512, 512) for r in range(3) for c in range(4)]},
    palette_origin=(0, 1984), pitch=32, cols=64, pad=8, gutter=14, margin=8,
    reach={'wall': (1.2, 2.6), 'roof': (2.6, 5.0)},
)
LAYOUTS['homes-hero'] = HOMES_HERO
