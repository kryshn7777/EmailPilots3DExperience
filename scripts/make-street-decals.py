"""The night city's road decal atlas: painted words and symbols, repairs, stains and street litter.

Everything here is drawn from code (PIL + numpy, no photographs, no third-party art), so the atlas is
ours to ship. Two images share one layout, an 8 x 8 grid of cells (CELLS below; a decal may span several):

- decals-color.webp  2048 px, RGBA: base colour (sRGB) and coverage. Painted markings are white/yellow
  thermoplastic with baked grit, cracks and missing flakes; the shader erodes them further in world space.
- decals-nrm.webp    1024 px, RGB: tangent-space normal x, y (0.5 = flat) and roughness, for HIGH only.

The cell table is also written to src/webgl/actors/roadDecalAtlas.ts, so the runtime never drifts from
the image:

    python3 scripts/make-street-decals.py

Conventions: u runs across a decal (left to right as a driver reads it), v along it, and the top of a
cell is the far end (what a driver sees last). Lengths in the runtime are city units (1 = 2.3 m).
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

GRID = 8
CELL = 256
SS = 2  # supersampling for the vector drawing
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'models', 'street-decals')
TS = os.path.join(ROOT, 'src', 'webgl', 'actors', 'roadDecalAtlas.ts')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# name: (col, row, w, h) in cells, row 0 at the top of the image
CELLS = {
    'busLane': (0, 0, 2, 4),
    'slow': (2, 0, 2, 4),
    'arrowAhead': (4, 0, 1, 4),
    'arrowLeft': (5, 0, 1, 4),
    'skid': (6, 0, 1, 4),
    'crackA': (7, 0, 1, 2),
    'crackB': (7, 2, 1, 2),
    'bike': (0, 4, 2, 2),
    'disabled': (2, 4, 2, 2),
    'patch': (4, 4, 2, 2),
    'hatch': (6, 4, 2, 2),
    'yield': (0, 6, 1, 1),
    'kerbYellow': (1, 6, 1, 1),
    'oil': (2, 6, 1, 1),
    'oilDrips': (3, 6, 1, 1),
    'puddleA': (4, 6, 1, 1),
    'puddleB': (5, 6, 1, 1),
    'manhole': (6, 6, 1, 1),
    'manholeSq': (7, 6, 1, 1),
    'spray': (0, 7, 1, 1),
    'spray2': (1, 7, 1, 1),
    'gum': (2, 7, 1, 1),
    'leaves': (3, 7, 1, 1),
    'litter': (4, 7, 1, 1),
    'footprints': (5, 7, 1, 1),
    'drain': (6, 7, 1, 1),
    'catsEye': (7, 7, 1, 1),
}

R = random.Random(4471)
NP = np.random.default_rng(4471)

PAINT = (222, 219, 204)
YELLOW = (224, 172, 38)


def noise(w, h, scale, octaves=3, seed=0):
    """value noise in [0, 1], tileless (decals do not tile)"""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale * 2 ** o))
        g = rng.random((s + 1, s + 1)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, np.float32) / 255 * amp
        tot += amp
        amp *= 0.5
    return out / tot


def blur(a, r):
    if r <= 0:
        return a
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), np.float32) / 255


def blurf(a, r):
    """float blur (three box passes, close to a gaussian of radius r), edges clamped"""
    k = max(1, int(round(r * 0.9)))
    out = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0), (0, 0)]
            pad[axis] = (k + 1, k)
            p = np.pad(out, pad, mode='edge')
            c = np.cumsum(p, axis=axis, dtype=np.float64)
            n = out.shape[axis]
            if axis == 0:
                out = ((c[2 * k + 1:2 * k + 1 + n] - c[0:n]) / (2 * k + 1)).astype(np.float32)
            else:
                out = ((c[:, 2 * k + 1:2 * k + 1 + n] - c[:, 0:n]) / (2 * k + 1)).astype(np.float32)
    return out


def mask(w, h, draw_fn):
    """a coverage mask drawn with PIL at SS x, downsampled (antialiased)"""
    im = Image.new('L', (w * SS, h * SS), 0)
    d = ImageDraw.Draw(im)
    draw_fn(d, SS)
    return np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255


class Layer:
    """one decal: colour (linear-ish 0..1 sRGB values), alpha, height, roughness"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.float32)
        self.a = np.zeros((h, w), np.float32)
        self.ht = np.zeros((h, w), np.float32)
        self.rough = np.full((h, w), 0.6, np.float32)

    def over(self, m, rgb, rough=None, height=0.0):
        m = np.clip(m, 0, 1)
        col = np.asarray(rgb, np.float32) / 255 if not isinstance(rgb, np.ndarray) else rgb
        if col.ndim == 1:
            col = np.broadcast_to(col, (self.h, self.w, 3))
        self.rgb = self.rgb * (1 - m[..., None]) + col * m[..., None]
        self.a = np.maximum(self.a, m) if True else self.a
        if rough is not None:
            self.rough = self.rough * (1 - m) + rough * m
        self.ht += m * height


def paint_wear(L, m, seed, grit=1.0, flakes=0.07):
    """thermoplastic: grit-dirty, hairline-cracked, flaked; asphalt shows through where it is gone"""
    w, h = L.w, L.h
    n1 = noise(w, h, 6, 4, seed)
    n2 = noise(w, h, 24, 2, seed + 1)
    # missing flakes: blotches where the paint has lifted
    gone = np.clip((n1 * 0.7 + n2 * 0.3 - (1 - flakes)) * 12, 0, 1)
    # hairline cracks: contour lines of a noise field
    cn = noise(w, h, 10, 3, seed + 2)
    crack = np.clip(1 - np.abs(cn - 0.5) / 0.012, 0, 1) * (n1 > 0.45)
    # grit: dark speckle
    speck = (NP.random((h, w)) > 1 - 0.035 * grit).astype(np.float32)
    speck = blur(speck, 0.6) * 1.5
    cov = m * (1 - gone) * (1 - crack * 0.9)
    tone = 0.82 + 0.18 * n2 - 0.35 * np.clip(speck, 0, 1)
    col = np.asarray(L._paint, np.float32)[None, None, :] / 255 * tone[..., None]
    L.over(cov, col, rough=0.5, height=0.9)


def text_mask(w, h, lines, stretch_fill=0.9):
    """road lettering: drawn upright, then stretched along v (road words are 2-3x taller than wide)"""
    big = Image.new('L', (w * SS, h * SS), 0)
    n = len(lines)
    seg = h * SS // n
    font = ImageFont.truetype(FONT, 200)
    for i, line in enumerate(lines):
        tw = Image.new('L', (1400, 260), 0)
        d = ImageDraw.Draw(tw)
        d.text((10, 10), line, font=font, fill=255)
        bb = tw.getbbox()
        tw = tw.crop(bb)
        tw = tw.resize((int(w * SS * stretch_fill), int(seg * 0.82)), Image.LANCZOS)
        # line 0 is nearest the driver: the bottom of the cell
        y = h * SS - (i + 1) * seg + int(seg * 0.09)
        big.paste(tw, ((w * SS - tw.width) // 2, y))
    return np.asarray(big.resize((w, h), Image.LANCZOS), np.float32) / 255


def d_text(lines):
    def f(L):
        L._paint = PAINT
        m = text_mask(L.w, L.h, lines)
        paint_wear(L, m, R.randrange(1 << 20))
    return f


def d_arrow(kind):
    def f(L):
        L._paint = PAINT
        w, h = L.w, L.h

        def draw(d, s):
            cx = w * s / 2
            sw = w * s * 0.16
            if kind == 'ahead':
                d.rectangle([cx - sw / 2, h * s * 0.38, cx + sw / 2, h * s * 0.97], fill=255)
                d.polygon([(cx - w * s * 0.42, h * s * 0.40), (cx + w * s * 0.42, h * s * 0.40), (cx, h * s * 0.03)], fill=255)
            else:
                # the stem up the lane, then a bend to the left with its head
                d.rectangle([cx + w * s * 0.05, h * s * 0.42, cx + w * s * 0.05 + sw, h * s * 0.97], fill=255)
                d.polygon([(cx + w * s * 0.05, h * s * 0.42), (cx + w * s * 0.05 + sw, h * s * 0.42),
                           (cx - w * s * 0.18 + sw, h * s * 0.22), (cx - w * s * 0.18, h * s * 0.22)], fill=255)
                d.polygon([(cx - w * s * 0.46, h * s * 0.03), (cx + w * s * 0.10, h * s * 0.13), (cx - w * s * 0.30, h * s * 0.36)], fill=255)
        m = mask(w, h, draw)
        paint_wear(L, m, R.randrange(1 << 20))
    return f


def d_bike(L):
    L._paint = PAINT
    w, h = L.w, L.h

    def draw(d, s):
        # a cycle-lane stencil seen from the side, stretched along v: rear wheel near, front wheel far
        lw = int(w * s * 0.04)
        p = lambda x, y: (w * s * x, h * s * y)
        rx, ry = 0.17, 0.17
        for cy in (0.72, 0.3):
            d.ellipse([w * s * (0.5 - rx), h * s * (cy - ry), w * s * (0.5 + rx), h * s * (cy + ry)], outline=255, width=lw)
        # frame: seat tube, top tube, down tube, chain stays, fork, handlebar, saddle
        for a, b in [((0.5, 0.72), (0.42, 0.52)), ((0.42, 0.52), (0.5, 0.36)), ((0.42, 0.52), (0.6, 0.56)),
                     ((0.6, 0.56), (0.5, 0.72)), ((0.5, 0.36), (0.5, 0.3)), ((0.5, 0.36), (0.6, 0.56)),
                     ((0.38, 0.36), (0.5, 0.36)), ((0.36, 0.5), (0.48, 0.5))]:
            d.line([p(*a), p(*b)], fill=255, width=lw)
    m = mask(w, h, draw)
    paint_wear(L, m, R.randrange(1 << 20), flakes=0.06)


def d_disabled(L):
    w, h = L.w, L.h
    sq = mask(w, h, lambda d, s: d.rounded_rectangle([w * s * 0.08, h * s * 0.08, w * s * 0.92, h * s * 0.92], radius=w * s * 0.05, fill=255))
    L._paint = (34, 92, 176)
    paint_wear(L, sq, R.randrange(1 << 20), flakes=0.18)

    def draw(d, s):
        lw = int(w * s * 0.045)
        p = lambda x, y: (w * s * x, h * s * y)
        d.ellipse([w * s * 0.47, h * s * 0.2, w * s * 0.57, h * s * 0.3], fill=255)
        d.line([p(0.5, 0.34), p(0.47, 0.56), p(0.63, 0.56), p(0.68, 0.72), p(0.74, 0.7)], fill=255, width=lw, joint='curve')
        d.line([p(0.47, 0.44), p(0.6, 0.44)], fill=255, width=lw)
        d.arc([w * s * 0.27, h * s * 0.46, w * s * 0.57, h * s * 0.78], 100, 400, fill=255, width=lw)
    m = mask(w, h, draw)
    L._paint = PAINT
    paint_wear(L, m, R.randrange(1 << 20), flakes=0.08)


def d_hatch(L):
    L._paint = PAINT
    w, h = L.w, L.h

    def draw(d, s):
        lw = int(w * s * 0.03)
        # a ghost island: a long diamond outline with chevrons inside
        pts = [(w * s * 0.5, h * s * 0.02), (w * s * 0.94, h * s * 0.5), (w * s * 0.5, h * s * 0.98), (w * s * 0.06, h * s * 0.5)]
        d.line(pts + [pts[0]], fill=255, width=lw)
        for k in range(1, 7):
            y = h * s * (0.06 + k * 0.13)
            d.line([(w * s * 0.14, y + h * s * 0.06), (w * s * 0.5, y - h * s * 0.04), (w * s * 0.86, y + h * s * 0.06)], fill=255, width=int(lw * 1.6))
    m = mask(w, h, draw)
    # keep the chevrons inside the diamond
    inside = mask(w, h, lambda d, s: d.polygon([(w * s * 0.5, h * s * 0.0), (w * s * 0.97, h * s * 0.5), (w * s * 0.5, h * s * 1.0), (w * s * 0.03, h * s * 0.5)], fill=255))
    paint_wear(L, m * inside, R.randrange(1 << 20))


def d_yield(L):
    L._paint = PAINT
    w, h = L.w, L.h

    def draw(d, s):
        for k in range(2):
            x0 = w * s * (0.04 + k * 0.5)
            d.polygon([(x0, h * s * 0.1), (x0 + w * s * 0.42, h * s * 0.1), (x0 + w * s * 0.21, h * s * 0.92)], fill=255)
    paint_wear(L, mask(w, h, draw), R.randrange(1 << 20))


def d_kerb(L):
    L._paint = YELLOW
    w, h = L.w, L.h

    def draw(d, s):
        for x in (0.22, 0.62):
            d.rectangle([w * s * x, 0, w * s * (x + 0.16), h * s], fill=255)
    paint_wear(L, mask(w, h, draw), R.randrange(1 << 20), flakes=0.2)


def blob(w, h, seed, cx=0.5, cy=0.5, rx=0.4, ry=0.4, rough=0.25):
    n = noise(w, h, 4, 3, seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx / w - cx) / rx) ** 2 + ((yy / h - cy) / ry) ** 2)
    return np.clip((1 - d + (n - 0.5) * rough * 2) * 6, 0, 1)


def d_patch(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    n = noise(w, h, 5, 3, 31)
    # a sawn rectangle with slightly ragged corners, the tar seal along its edge
    jx = (noise(w, h, 3, 2, 32) - 0.5) * 0.02
    inx = np.minimum(xx / w - 0.06 + jx, 0.94 - xx / w + jx)
    iny = np.minimum(yy / h - 0.08 + jx, 0.92 - yy / h + jx)
    ins = np.minimum(inx, iny)
    body = np.clip(ins * 300, 0, 1)
    seal = np.clip(1 - np.abs(ins) * 70, 0, 1) * np.clip(0.6 + n, 0, 1)
    seal = np.maximum(seal, 0)
    agg = NP.random((h, w)).astype(np.float32)
    agg = blur((agg > 0.82).astype(np.float32), 0.7)
    # newer asphalt: a shade off the road's own, coarser, the aggregate showing
    tone = (0.1 + 0.035 * n + 0.06 * agg)[..., None] * np.array([1.0, 1.02, 1.08])[None, None, :]
    L.over(body * 0.6, tone, rough=0.62, height=0.3)
    L.over(seal * 0.95, np.array([12, 12, 14], np.float32) / 255, rough=0.22, height=0.6)


def d_oil(L, drips=False):
    w, h = L.w, L.h
    seed = R.randrange(1 << 20)
    if drips:
        m = np.zeros((h, w), np.float32)
        for _ in range(9):
            m = np.maximum(m, blob(w, h, R.randrange(1 << 20), R.uniform(0.25, 0.75), R.uniform(0.2, 0.8), R.uniform(0.03, 0.09), R.uniform(0.03, 0.09), 0.4) * R.uniform(0.5, 0.9))
    else:
        m = blob(w, h, seed, rx=0.42, ry=0.36, rough=0.5)
        m = m * (0.55 + 0.45 * noise(w, h, 8, 2, seed + 3))
    n = noise(w, h, 6, 2, seed + 5)
    # a thin film: brown-black with a faint oily sheen
    col = np.stack([0.05 + 0.03 * n, 0.04 + 0.02 * n, 0.035 + 0.035 * (1 - n)], -1)
    L.over(m * 0.85, col, rough=0.12, height=0.0)


def d_puddle(L, seed):
    w, h = L.w, L.h
    m = blob(w, h, seed, rx=0.44, ry=0.4, rough=0.7)
    m = blurf(m, 3)
    col = np.full((h, w, 3), 0.02, np.float32)
    L.over(m * 0.9, col, rough=0.02, height=-0.4)
    # the damp rim around the water
    rim = np.clip(blurf(m, 10) * 1.6 - m, 0, 1)
    L.a = np.maximum(L.a, rim * 0.5)
    L.rough = np.minimum(L.rough, 0.02 + (1 - rim) * 0.6)


def d_manhole(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = xx / w - 0.5, yy / h - 0.5
    r = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx)
    cover = np.clip((0.43 - r) * w, 0, 1)
    frame = np.clip((0.49 - r) * w, 0, 1) - cover
    gap = np.clip(1 - np.abs(r - 0.432) * w / 1.5, 0, 1)
    # cast pattern: concentric rings and radial ribs, raised studs between
    rings = (np.sin(r * 2 * math.pi * 11) > 0.55).astype(np.float32) * (r < 0.3)
    ribs = (np.sin(ang * 16) > 0.75).astype(np.float32) * (r < 0.3) * (r > 0.08)
    pattern = np.clip(rings + ribs, 0, 1)
    n = noise(w, h, 8, 3, 77)
    base = 0.11 + 0.05 * n
    iron = np.stack([base, base * 0.98, base * 0.95], -1)
    L.over(frame, np.stack([base * 1.3] * 3, -1), rough=0.35, height=0.2)
    L.over(cover, iron, rough=0.55, height=0.0)
    # raised pattern, worn bright on top where tyres polish it
    L.over(pattern * cover, np.stack([base + 0.1 * n] * 3, -1), rough=0.25, height=0.7)
    # lettering round the band between pattern and rim
    im = Image.new('L', (w * SS, h * SS), 0)
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, int(w * SS * 0.07))
    word = 'SEWER • CITY • 1931 • '
    for i, ch in enumerate(word):
        a = -math.pi / 2 + i * 2 * math.pi / len(word)
        cx = w * SS / 2 + math.cos(a) * w * SS * 0.365
        cy = h * SS / 2 + math.sin(a) * h * SS * 0.365
        g = Image.new('L', (int(w * SS * 0.1), int(w * SS * 0.1)), 0)
        ImageDraw.Draw(g).text((g.width * 0.15, 0), ch, font=font, fill=255)
        g = g.rotate(-math.degrees(a) - 90, resample=Image.BICUBIC)
        im.paste(255, (int(cx - g.width / 2), int(cy - g.height / 2)), g)
    letters = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255
    L.over(letters * cover, np.stack([base + 0.12] * 3, -1), rough=0.25, height=0.8)
    L.over(gap * 0.9, np.zeros(3, np.float32), rough=0.4, height=-1.0)


def d_manhole_sq(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    ins = np.minimum(np.minimum(u - 0.1, 0.9 - u), np.minimum(v - 0.1, 0.9 - v))
    frame = np.clip((ins + 0.06) * w, 0, 1)
    cover = np.clip(ins * w - 3, 0, 1)
    n = noise(w, h, 8, 3, 78)
    base = 0.12 + 0.05 * n
    L.over(frame, np.stack([base * 1.35] * 3, -1), rough=0.35, height=0.2)
    # diamond tread plate
    tread = ((np.abs(((u + v) * 22) % 1 - 0.5) < 0.12) | (np.abs(((u - v) * 22) % 1 - 0.5) < 0.12)).astype(np.float32)
    L.over(cover, np.stack([base] * 3, -1), rough=0.5, height=0.0)
    L.over(tread * cover, np.stack([base + 0.07] * 3, -1), rough=0.25, height=0.6)
    im = Image.new('L', (w * SS, h * SS), 0)
    font = ImageFont.truetype(FONT, int(w * SS * 0.2))
    ImageDraw.Draw(im).text((w * SS / 2, h * SS / 2), 'GAS', font=font, fill=255, anchor='mm')
    lab = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255
    clear = blur(lab, 3) > 0.02
    tread = tread * (1 - clear)
    L.over(lab * cover, np.stack([base + 0.15] * 3, -1), rough=0.25, height=0.8)


def d_spray(L, variant):
    """utility dig marks: authored white, tinted fluorescent per instance"""
    w, h = L.w, L.h

    def draw(d, s):
        lw = int(w * s * 0.035)
        p = lambda x, y: (w * s * x, h * s * y)
        if variant == 0:
            d.line([p(0.12, 0.85), p(0.12, 0.2)], fill=255, width=lw)
            d.line([p(0.04, 0.3), p(0.12, 0.14), p(0.2, 0.3)], fill=255, width=lw)
            font = ImageFont.truetype(FONT, int(w * s * 0.3))
            d.text(p(0.35, 0.3), 'G', font=font, fill=255)
            for k in range(4):
                d.line([p(0.3 + k * 0.17, 0.82), p(0.4 + k * 0.17, 0.82)], fill=255, width=lw)
        else:
            d.line([p(0.2, 0.2), p(0.8, 0.8)], fill=255, width=lw)
            d.line([p(0.8, 0.2), p(0.2, 0.8)], fill=255, width=lw)
            d.ellipse([w * s * 0.3, h * s * 0.3, w * s * 0.7, h * s * 0.7], outline=255, width=lw)
            font = ImageFont.truetype(FONT, int(w * s * 0.14))
            d.text(p(0.06, 0.02), 'ELEC', font=font, fill=255)
    m = mask(w, h, draw)
    # overspray: soft halo and droplets
    halo = blur(m, 3) * 0.35
    drops = blur((NP.random((h, w)) > 0.997).astype(np.float32), 0.5) * blur(m, 10) * 4
    cov = np.clip(np.maximum(m, halo) + drops, 0, 1) * (0.8 + 0.2 * noise(w, h, 12, 2, variant + 9))
    L.over(cov, np.full((h, w, 3), 0.95, np.float32), rough=0.55, height=0.1)


def d_scatter(L, kind):
    w, h = L.w, L.h
    im_rgb = Image.new('RGB', (w * SS, h * SS), 0)
    im_a = Image.new('L', (w * SS, h * SS), 0)
    dr, da = ImageDraw.Draw(im_rgb), ImageDraw.Draw(im_a)
    s = SS
    if kind == 'gum':
        for _ in range(40):
            x, y = R.uniform(0.05, 0.95) * w * s, R.uniform(0.05, 0.95) * h * s
            r = R.uniform(0.012, 0.03) * w * s
            v = R.randint(28, 70)
            dr.ellipse([x - r, y - r * R.uniform(0.8, 1.2), x + r, y + r], fill=(v, v, v - 4))
            da.ellipse([x - r, y - r, x + r, y + r], fill=255)
    elif kind == 'leaves':
        for _ in range(26):
            x, y = R.uniform(0.1, 0.9) * w * s, R.uniform(0.1, 0.9) * h * s
            a = R.uniform(0, math.pi)
            l, b = R.uniform(0.05, 0.09) * w * s, R.uniform(0.025, 0.04) * w * s
            col = R.choice([(118, 70, 28), (150, 92, 30), (96, 60, 30), (120, 104, 40), (80, 46, 24)])
            pts = []
            for k in range(14):
                t = k / 13 * 2 * math.pi
                px, py = math.cos(t) * l, math.sin(t) * b * (1 - 0.3 * math.cos(t))
                pts.append((x + px * math.cos(a) - py * math.sin(a), y + px * math.sin(a) + py * math.cos(a)))
            dr.polygon(pts, fill=col)
            da.polygon(pts, fill=255)
            dr.line([pts[0], (x - math.cos(a) * l * 1.3, y - math.sin(a) * l * 1.3)], fill=(60, 40, 20), width=s)
    elif kind == 'litter':
        for _ in range(9):
            # cigarette ends
            x, y = R.uniform(0.1, 0.9) * w * s, R.uniform(0.1, 0.9) * h * s
            a = R.uniform(0, math.pi)
            l, b = 0.05 * w * s, 0.012 * w * s
            c, sn = math.cos(a), math.sin(a)
            quad = lambda u0, u1: [(x + u0 * c - b * sn, y + u0 * sn + b * c), (x + u1 * c - b * sn, y + u1 * sn + b * c),
                                   (x + u1 * c + b * sn, y + u1 * sn - b * c), (x + u0 * c + b * sn, y + u0 * sn - b * c)]
            dr.polygon(quad(-l, 0), fill=(205, 140, 70))
            dr.polygon(quad(0, l * 0.8), fill=(220, 216, 205))
            da.polygon(quad(-l, l * 0.8), fill=255)
        for _ in range(4):
            # scraps of paper, crumpled, soaked
            x, y = R.uniform(0.15, 0.85) * w * s, R.uniform(0.15, 0.85) * h * s
            pts = [(x + R.uniform(-1, 1) * 0.07 * w * s, y + R.uniform(-1, 1) * 0.07 * h * s) for _ in range(6)]
            v = R.randint(150, 200)
            dr.polygon(pts, fill=(v, v - 4, v - 14))
            da.polygon(pts, fill=230)
        for _ in range(2):
            x, y = R.uniform(0.2, 0.8) * w * s, R.uniform(0.2, 0.8) * h * s
            r = 0.022 * w * s
            dr.ellipse([x - r, y - r, x + r, y + r], fill=(150, 150, 160))
            da.ellipse([x - r, y - r, x + r, y + r], fill=255)
    elif kind == 'footprints':
        for k in range(6):
            side = 1 if k % 2 else -1
            x = (0.5 + side * 0.09 + R.uniform(-0.02, 0.02)) * w * s
            y = (0.92 - k * 0.15) * h * s
            # sole and heel of a wet shoe
            dr.ellipse([x - 0.045 * w * s, y - 0.07 * h * s, x + 0.045 * w * s, y + 0.01 * h * s], fill=(8, 8, 9))
            da.ellipse([x - 0.045 * w * s, y - 0.07 * h * s, x + 0.045 * w * s, y + 0.01 * h * s], fill=int(200 - k * 26))
            dr.ellipse([x - 0.035 * w * s, y + 0.03 * h * s, x + 0.035 * w * s, y + 0.075 * h * s], fill=(8, 8, 9))
            da.ellipse([x - 0.035 * w * s, y + 0.03 * h * s, x + 0.035 * w * s, y + 0.075 * h * s], fill=int(200 - k * 26))
    rgb = np.asarray(im_rgb.resize((w, h), Image.LANCZOS), np.float32) / 255
    a = np.asarray(im_a.resize((w, h), Image.LANCZOS), np.float32) / 255
    rough = {'gum': 0.6, 'leaves': 0.35, 'litter': 0.6, 'footprints': 0.05}[kind]
    if kind == 'gum':
        a = a * 0.9
    L.over(a, np.clip(rgb / np.maximum(a[..., None], 1e-3), 0, 1), rough=rough, height=0.3 if kind != 'footprints' else -0.2)


def d_drain(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    ins = np.minimum(np.minimum(u - 0.22, 0.78 - u), np.minimum(v - 0.3, 0.7 - v))
    pit = np.clip(ins * w, 0, 1)
    # the damp, silted stain round it and a trail of grime toward it
    stain = np.clip(blurf(pit, 18) * 2.2, 0, 1) * (0.6 + 0.4 * noise(w, h, 6, 2, 12))
    L.over(stain * 0.75, np.full((h, w, 3), 0.03, np.float32), rough=0.08, height=0.0)
    L.over(pit, np.full((h, w, 3), 0.004, np.float32), rough=0.4, height=-1.0)


def d_catseye(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    ins = np.minimum(np.minimum(u - 0.18, 0.82 - u), np.minimum(v - 0.3, 0.7 - v))
    body = np.clip(ins * w * 0.5, 0, 1)
    L.over(body, np.full((h, w, 3), 0.3, np.float32), rough=0.3, height=1.0)
    for cx in (0.34, 0.66):
        lens = np.clip((0.07 - np.sqrt(((u - cx) / 1.0) ** 2 + ((v - 0.5) / 0.7) ** 2)) * w, 0, 1)
        L.over(lens, np.full((h, w, 3), 1.0, np.float32), rough=0.05, height=1.2)


def d_skid(L):
    w, h = L.w, L.h
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    m = np.zeros((h, w), np.float32)
    streak = noise(w, h, 3, 2, 51)
    grain = np.asarray(Image.fromarray((NP.random((4, w)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    for cx in (0.3, 0.7):
        tyre = np.clip(1 - np.abs(u - cx - (v - 0.5) * 0.03) / 0.1, 0, 1) ** 0.6
        m = np.maximum(m, tyre)
    # fades in as the tyre bites (bottom = where it started), darkest toward the stop
    ramp = np.clip((1 - v) * 3, 0, 1) * np.clip(v * 8, 0, 1)
    m = m * ramp * (0.55 + 0.45 * grain) * (0.6 + 0.4 * streak)
    L.over(m * 0.85, np.full((h, w, 3), 0.015, np.float32), rough=0.3, height=0.0)


def d_crack(L, seed):
    w, h = L.w, L.h
    im = Image.new('L', (w * SS, h * SS), 0)
    d = ImageDraw.Draw(im)
    rr = random.Random(seed)

    def walk(x, y, a, n, width):
        pts = [(x, y)]
        for _ in range(n):
            a += rr.uniform(-0.5, 0.5)
            a = a * 0.8 + (-math.pi / 2) * 0.2
            x += math.cos(a) * 8 * SS
            y += math.sin(a) * 8 * SS
            pts.append((x, y))
            if rr.random() < 0.08 and width > 3:
                walk(x, y, a + rr.choice([-1, 1]) * rr.uniform(0.6, 1.2), n // 3, width * 0.6)
        d.line(pts, fill=255, width=int(width), joint='curve')
    walk(w * SS * 0.5, h * SS * 0.97, -math.pi / 2, 58, 6 * SS)
    tar = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255
    # crack sealer: a band of tar wider than the crack, smeared by the squeegee
    band = np.clip(blur(tar, 2.5) * 2.5, 0, 1)
    L.over(band * 0.9, np.full((h, w, 3), 0.025, np.float32), rough=0.22, height=0.4)
    L.over(tar, np.full((h, w, 3), 0.01, np.float32), rough=0.5, height=-0.6)


DRAW = {
    'busLane': d_text(['BUS', 'LANE']),
    'slow': d_text(['SLOW']),
    'arrowAhead': d_arrow('ahead'),
    'arrowLeft': d_arrow('left'),
    'skid': d_skid,
    'crackA': lambda L: d_crack(L, 5),
    'crackB': lambda L: d_crack(L, 9),
    'bike': d_bike,
    'disabled': d_disabled,
    'patch': d_patch,
    'hatch': d_hatch,
    'yield': d_yield,
    'kerbYellow': d_kerb,
    'oil': lambda L: d_oil(L),
    'oilDrips': lambda L: d_oil(L, True),
    'puddleA': lambda L: d_puddle(L, 61),
    'puddleB': lambda L: d_puddle(L, 62),
    'manhole': d_manhole,
    'manholeSq': d_manhole_sq,
    'spray': lambda L: d_spray(L, 0),
    'spray2': lambda L: d_spray(L, 1),
    'gum': lambda L: d_scatter(L, 'gum'),
    'leaves': lambda L: d_scatter(L, 'leaves'),
    'litter': lambda L: d_scatter(L, 'litter'),
    'footprints': lambda L: d_scatter(L, 'footprints'),
    'drain': d_drain,
    'catsEye': d_catseye,
}


def bleed(rgb, a):
    """fill transparent texels with nearby colour so filtering and webp do not fringe the edges"""
    w = np.clip(a, 0, 1)
    acc = rgb * w[..., None]
    out = rgb.copy()
    for r in (2, 6, 16, 40):
        num = np.stack([blurf(acc[..., c], r) for c in range(3)], -1)
        den = blurf(w, r)[..., None]
        fill = num / np.maximum(den, 1e-4)
        need = (w < 0.02)[..., None] & (den > 1e-4)
        out = np.where(need, fill, out)
        w = np.maximum(w, (den[..., 0] > 1e-3) * 0.03)
    return out


def main():
    S = GRID * CELL
    rgb = np.zeros((S, S, 3), np.float32)
    a = np.zeros((S, S), np.float32)
    ht = np.zeros((S, S), np.float32)
    rough = np.full((S, S), 0.6, np.float32)
    for name, (c, r, cw, chh) in CELLS.items():
        w, h = cw * CELL, chh * CELL
        L = Layer(w, h)
        DRAW[name](L)
        # a texel of clear border so neighbours never bleed in under mipmapping
        pad = 3
        L.a[:pad, :] = L.a[-pad:, :] = 0
        L.a[:, :pad] = L.a[:, -pad:] = 0
        ys, xs = r * CELL, c * CELL
        rgb[ys:ys + h, xs:xs + w] = L.rgb
        a[ys:ys + h, xs:xs + w] = L.a
        ht[ys:ys + h, xs:xs + w] = L.ht
        rough[ys:ys + h, xs:xs + w] = L.rough
        print('drew', name)
    rgb = bleed(rgb, a)
    os.makedirs(OUT, exist_ok=True)
    col = np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0, 1)[..., None]], -1)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8), 'RGBA').save(
        os.path.join(OUT, 'decals-color.webp'), 'WEBP', quality=86, alpha_quality=90, method=6)
    # normals from the height field (smoothed a touch), at half resolution
    hs = blurf(np.clip(ht * 0.25 + 0.5, 0, 1), 1.2)
    gy, gx = np.gradient(hs)
    k = 6.0
    nx, ny = -gx * k * 4, gy * k * 4  # image y runs down; v runs up
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, np.clip(rough, 0, 1)], -1)
    Image.fromarray((nrm * 255 + 0.5).astype(np.uint8), 'RGB').resize((S // 2, S // 2), Image.LANCZOS).save(
        os.path.join(OUT, 'decals-nrm.webp'), 'WEBP', quality=88, method=6)
    # the cell table for the runtime: uv rect (u0, v0, du, dv) with v up (three flips the image on load)
    lines = [
        '// generated by scripts/make-street-decals.py: do not edit by hand',
        '/** uv rect of each decal in public/models/street-decals/decals-*.webp: u0, v0, du, dv (v up) */',
        'export const DECAL_CELLS = {',
    ]
    for name, (c, r, cw, chh) in CELLS.items():
        u0, v0 = c / GRID, 1 - (r + chh) / GRID
        lines.append(f'  {name}: [{u0:.4f}, {v0:.4f}, {cw / GRID:.4f}, {chh / GRID:.4f}],')
    lines += ['} as const;', 'export type DecalName = keyof typeof DECAL_CELLS;', '']
    with open(TS, 'w') as f:
        f.write('\n'.join(lines))
    for fn in ('decals-color.webp', 'decals-nrm.webp'):
        print(fn, os.path.getsize(os.path.join(OUT, fn)) // 1024, 'KB')


if __name__ == '__main__':
    main()
