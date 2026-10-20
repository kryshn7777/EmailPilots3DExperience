"""Paints the neighbourhood ground: ONE cell of streets, sidewalks and lawns that
the site repeats across the whole district.

    python blender/make_ground.py

The cell geometry is HOME_CELL in src/webgl/bake/cityGen.mjs and must match it
(the houses are placed on the same grid). Everything noisy is built from
periodic value noise, so the cell tiles with no seam however many times it is
repeated; there is no Blender in this one, just numpy and Pillow.

Writes public/models/homes/ground-color.webp and ground-glow.webp (the
streetlamp pools). `LAMPS` is mirrored by the lamp sprites in Rooftops.ts.
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- must match HOME_CELL in cityGen.mjs ------------------------------------------
W, D, LOT_W, LOTS, LOT_D, STREET, CROSS = 32.0, 26.0, 7.0, 4, 10.0, 6.0, 4.0
PX = 2048
SX, SZ = PX / W, PX / D          # pixels per unit along each axis
SIDEWALK, VERGE = 1.1, 0.7       # widths; the curb sits at the street edge
# streetlamp positions in cell units: (x, z)
LAMPS = [(x, z) for x in (3.5, 17.5) for z in (LOT_D + 0.55, LOT_D + STREET - 0.55)]

rng = np.random.default_rng(20261020)


def noise(gx, gz, seed):
    """Periodic value noise on a (PX, PX) grid with gx x gz lattice cells."""
    r = np.random.default_rng(seed)
    lat = r.random((gz, gx))
    ys = np.linspace(0, gz, PX, endpoint=False)
    xs = np.linspace(0, gx, PX, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = lat[y0 % gz][:, x0 % gx]
    b = lat[y0 % gz][:, (x0 + 1) % gx]
    c = lat[(y0 + 1) % gz][:, x0 % gx]
    d = lat[(y0 + 1) % gz][:, (x0 + 1) % gx]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def fbm(base, octaves, seed, gain=0.5):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * noise(base * 2 ** o, max(1, round(base * 2 ** o * D / W)), seed + o)
        tot += amp
        amp *= gain
    return out / tot


def rect(x0, z0, x1, z1):
    return [x0 * SX, z0 * SZ, x1 * SX, z1 * SZ]


def mask_of(draw_fn, blur=0.0):
    m = Image.new('L', (PX, PX), 0)
    draw_fn(ImageDraw.Draw(m))
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m, dtype=np.float32) / 255.0


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def main():
    h = np.zeros((PX, PX, 3), np.float32)

    # ---- lawn: mown stripes, dry patches, clover, fine grain ------------------------
    patch = fbm(3, 4, 11)
    grain = fbm(160, 2, 17)
    stripe = (np.sin(np.arange(PX)[None, :] / SX * np.pi / 0.75) * 0.5 + 0.5)
    lawn = np.array([0.30, 0.43, 0.20], np.float32)
    dry = np.array([0.46, 0.50, 0.26], np.float32)
    lush = np.array([0.20, 0.34, 0.15], np.float32)
    img = lerp(lerp(lush, lawn, np.clip(patch * 1.6, 0, 1)), dry, np.clip((patch - 0.55) * 2.2, 0, 1) * 0.7)
    img = img * (0.93 + 0.14 * grain[..., None]) * (0.97 + 0.06 * stripe[..., None])
    h[:] = img

    # ---- streets: asphalt with wear, patches and darker tyre lines ------------------
    street_z0, street_z1 = LOT_D, LOT_D + STREET
    cross_x0 = LOTS * LOT_W
    asphalt_m = mask_of(lambda d: (d.rectangle(rect(0, street_z0 + VERGE + SIDEWALK, W,
                                                    street_z1 - VERGE - SIDEWALK), fill=255),
                                   d.rectangle(rect(cross_x0 + VERGE + SIDEWALK, 0, W - VERGE - SIDEWALK, D),
                                               fill=255)), 0.7)
    wear = fbm(9, 5, 23)
    asphalt = lerp(np.array([0.145, 0.150, 0.160], np.float32), np.array([0.235, 0.240, 0.250], np.float32),
                   np.clip(wear * 1.1 - 0.15, 0, 1))
    asphalt = asphalt * (0.94 + 0.12 * fbm(220, 2, 29)[..., None])
    zc = (street_z0 + street_z1) / 2
    for dz in (-0.55, 0.55):    # tyre-polished lines either side of the centre
        lane = mask_of(lambda d, dz=dz: d.rectangle(rect(0, zc + dz - 0.32, W, zc + dz + 0.32), fill=255), 18)
        asphalt = asphalt * (1 - 0.16 * lane[..., None])
    h = h * (1 - asphalt_m[..., None]) + asphalt * asphalt_m[..., None]

    # ---- sidewalks and curbs ----------------------------------------------------------
    def walk(d):
        for z0, z1 in ((street_z0 + VERGE, street_z0 + VERGE + SIDEWALK),
                       (street_z1 - VERGE - SIDEWALK, street_z1 - VERGE)):
            d.rectangle(rect(0, z0, W, z1), fill=255)
        for x0, x1 in ((cross_x0 + VERGE, cross_x0 + VERGE + SIDEWALK),
                       (W - VERGE - SIDEWALK, W - VERGE)):
            d.rectangle(rect(x0, 0, x1, D), fill=255)
    walk_m = mask_of(walk, 0.5)
    conc = np.array([0.50, 0.50, 0.48], np.float32) * (0.9 + 0.2 * fbm(40, 3, 31)[..., None])
    # slab joints every 1.5 units
    joints = np.zeros((PX, PX), np.float32)
    jx = (np.arange(PX) / SX) % 1.5 < 0.04
    jz = (np.arange(PX) / SZ) % 1.5 < 0.04
    joints = np.maximum(jx[None, :], jz[:, None]).astype(np.float32)
    conc = conc * (1 - 0.35 * joints[..., None])
    h = h * (1 - walk_m[..., None]) + conc * walk_m[..., None]

    def curb(d):
        for z in (street_z0 + VERGE + SIDEWALK, street_z1 - VERGE - SIDEWALK):
            d.rectangle(rect(0, z - 0.06, W, z + 0.06), fill=255)
        for x in (cross_x0 + VERGE + SIDEWALK, W - VERGE - SIDEWALK):
            d.rectangle(rect(x - 0.06, 0, x + 0.06, D), fill=255)
    curb_m = mask_of(curb, 0.8)
    h = h * (1 - 0.55 * curb_m[..., None])

    # ---- markings --------------------------------------------------------------------
    def dashes(d):
        x = 0.4
        while x < cross_x0 + 0.5:
            d.rectangle(rect(x, zc - 0.07, x + 1.5, zc + 0.07), fill=255)
            x += 3.0
        z = 0.5
        while z < D:
            if not (street_z0 - 0.5 < z < street_z1 + 0.5):
                d.rectangle(rect(W - CROSS / 2 - 0.07, z, W - CROSS / 2 + 0.07, z + 1.5), fill=255)
            z += 3.0
    paint = mask_of(dashes, 0.6)
    h = h * (1 - 0.8 * paint[..., None]) + np.array([0.78, 0.72, 0.38], np.float32) * 0.8 * paint[..., None]

    def zebra(d):
        # crosswalk bars on the main street, west of the cross street
        for k in range(8):
            d.rectangle(rect(cross_x0 - 2.2, street_z0 + VERGE + SIDEWALK + 0.3 + k * 0.6,
                             cross_x0 - 0.4, street_z0 + VERGE + SIDEWALK + 0.62 + k * 0.6), fill=255)
    zeb = mask_of(zebra, 0.6)
    h = h * (1 - 0.7 * zeb[..., None]) + np.array([0.8, 0.8, 0.78], np.float32) * 0.7 * zeb[..., None]

    # ---- lots: front walks, property lines, garden beds, driveways' oil stains ----------
    def lots(d):
        for row in (0, 1):
            z_front = LOT_D if row == 0 else LOT_D + STREET
            for k in range(LOTS):
                cx = k * LOT_W + LOT_W / 2
                # walkway from the sidewalk to the front door
                z0, z1 = (z_front - 2.6, street_z0 + VERGE) if row == 0 else \
                         (street_z1 - VERGE, z_front + 2.6)
                d.rectangle(rect(cx - 0.45, z0, cx + 0.45, z1), fill=255)
    walk2 = mask_of(lots, 0.5)
    h = h * (1 - 0.8 * walk2[..., None]) + conc * 0.95 * walk2[..., None]

    def lines(d):
        for k in range(1, LOTS):
            x = k * LOT_W
            d.line([x * SX, 0, x * SX, LOT_D * SZ], fill=255, width=3)
            d.line([x * SX, (LOT_D + STREET) * SZ, x * SX, D * SZ], fill=255, width=3)
    pl = mask_of(lines, 2.0)
    h = h * (1 - 0.32 * pl[..., None])

    # ---- leaf litter and dirt specks across everything --------------------------------
    speck = (fbm(300, 1, 41) > 0.78).astype(np.float32) * 0.5
    h = h * (1 - 0.12 * speck[..., None])

    h = np.clip(h, 0, 1)
    out = os.path.join(ROOT, 'public', 'models', 'homes')
    os.makedirs(out, exist_ok=True)
    # the colours above are authored directly as sRGB, so they are stored as-is
    Image.fromarray((h * 255).astype(np.uint8)).save(
        os.path.join(out, 'ground-color.webp'), 'WEBP', quality=88, method=6)

    # ---- streetlamp pools (emissive map, 512 px) --------------------------------------
    gp = 512
    glow = np.zeros((gp, gp), np.float32)
    zz, xx = np.mgrid[0:gp, 0:gp]
    for lx, lz in LAMPS:
        for ox in (-W, 0, W):
            for oz in (-D, 0, D):
                dx = (xx / gp * W) - (lx + ox)
                dz = (zz / gp * D) - (lz + oz)
                glow += np.exp(-(dx * dx + dz * dz) / (2 * 1.7 ** 2))
    glow = np.clip(glow, 0, 1)
    warm = np.stack([glow * 1.0, glow * 0.72, glow * 0.38], axis=-1)
    Image.fromarray((np.clip(warm, 0, 1) * 255).astype(np.uint8)).save(
        os.path.join(out, 'ground-glow.webp'), 'WEBP', quality=85)
    print('ground written to', out)


main()
