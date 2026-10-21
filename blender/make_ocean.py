"""Tileable ocean surface maps from a wave spectrum.

    python blender/make_ocean.py

Writes public/models/ocean/ocean-normal.webp and ocean-foam.webp (numpy and Pillow
only, no Blender). Both tile seamlessly, one tile covering TILE site units:

  ocean-normal   RGB = world-space normal of the surface, as (x, z, y) * 0.5 + 0.5.
                 Phillips-spectrum waves with a downwind bias, 512 px, lossless.
  ocean-foam     R = foam where the surface is breaking (the Jacobian of the choppy
                 displacement going under zero, then blurred), G = lacy bubble
                 detail, B = surface height. 512 px.

The shader (src/webgl/shaders/ocean.frag.glsl) samples the normals at three scales
and rotations so the tile never reads as a repeat.
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 512
TILE = 64.0          # site units per tile
WIND = np.array([0.82, 0.57])
WIND /= np.linalg.norm(WIND)
rng = np.random.default_rng(20261021)


def spectrum():
    """Height spectrum h(k): Phillips, with small waves damped and a crosswind floor."""
    kx = np.fft.fftfreq(N, d=TILE / N) * 2 * np.pi
    kz = np.fft.fftfreq(N, d=TILE / N) * 2 * np.pi
    KX, KZ = np.meshgrid(kx, kz)
    k = np.hypot(KX, KZ)
    k[0, 0] = 1e-6
    L = 14.0                                     # largest wave that matters at this tile size
    along = (KX * WIND[0] + KZ * WIND[1]) / k
    p = np.exp(-1.0 / (k * L) ** 2) / k ** 4 * np.abs(along) ** 2
    p *= np.exp(-(k * 0.20) ** 2)                # kill the smallest waves; the shader adds ripples
    p *= 0.12 + 0.88 * (along > 0)               # waves travel downwind, a few against
    p[0, 0] = 0
    noise = rng.normal(size=(N, N)) + 1j * rng.normal(size=(N, N))
    return noise * np.sqrt(p / 2), KX, KZ, k


def main():
    h0, KX, KZ, k = spectrum()
    h = np.fft.ifft2(h0).real * N * N
    # slopes by spectral differentiation
    hx = np.fft.ifft2(1j * KX * h0).real * N * N
    hz = np.fft.ifft2(1j * KZ * h0).real * N * N
    slope = np.sqrt((hx ** 2 + hz ** 2).mean())
    gain = 0.32 / slope                          # a rough sea: ~0.32 rms slope
    h, hx, hz = h * gain, hx * gain, hz * gain

    nrm = np.stack([-hx, np.ones_like(hx), -hz], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    enc = np.stack([nrm[..., 0], nrm[..., 2], nrm[..., 1]], axis=-1) * 0.5 + 0.5
    os.makedirs(os.path.join(ROOT, 'public', 'models', 'ocean'), exist_ok=True)
    out = os.path.join(ROOT, 'public', 'models', 'ocean')
    Image.fromarray((np.clip(enc, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(out, 'ocean-normal.webp'), 'WEBP', lossless=True, method=6)

    # choppy displacement and its Jacobian: where it dips below zero the crest folds over
    lam = 0.9
    dx = np.fft.ifft2(-1j * KX / k * h0).real * N * N * gain
    dz = np.fft.ifft2(-1j * KZ / k * h0).real * N * N * gain
    ddx_dx = np.fft.ifft2(1j * KX * (-1j * KX / k * h0)).real * N * N * gain
    ddz_dz = np.fft.ifft2(1j * KZ * (-1j * KZ / k * h0)).real * N * N * gain
    ddx_dz = np.fft.ifft2(1j * KZ * (-1j * KX / k * h0)).real * N * N * gain
    jac = (1 + lam * ddx_dx) * (1 + lam * ddz_dz) - (lam * ddx_dz) ** 2
    foam = np.clip((0.55 - jac) / 0.55, 0, 1) ** 0.8
    # soften with a periodic blur so patches have a wispy edge
    f = np.fft.fft2(foam)
    kk = np.hypot(*np.meshgrid(np.fft.fftfreq(N), np.fft.fftfreq(N)))
    foam = np.fft.ifft2(f * np.exp(-(kk * 9.0) ** 2)).real
    foam = np.clip(foam / max(foam.max(), 1e-6) * 1.5, 0, 1)

    # lacy bubbles: periodic ridged noise, thin bright veins
    def pnoise(cells, seed):
        r = np.random.default_rng(seed)
        lat = r.random((cells, cells))
        t = np.linspace(0, cells, N, endpoint=False)
        i0 = np.floor(t).astype(int)
        f = t - i0
        f = f * f * (3 - 2 * f)
        rows0, rows1 = lat[i0 % cells], lat[(i0 + 1) % cells]
        a, b = rows0[:, i0 % cells], rows0[:, (i0 + 1) % cells]
        c, d = rows1[:, i0 % cells], rows1[:, (i0 + 1) % cells]
        top = a * (1 - f)[None, :] + b * f[None, :]
        bot = c * (1 - f)[None, :] + d * f[None, :]
        return top * (1 - f)[:, None] + bot * f[:, None]
    lace = sum((1 - np.abs(2 * pnoise(c, 10 + c) - 1)) ** 3 / (i + 1) for i, c in enumerate((24, 48, 96, 192)))
    lace = np.clip((lace / lace.max() - 0.35) * 1.8, 0, 1)

    hn = (h - h.min()) / (h.max() - h.min())
    img = np.stack([foam, lace, hn], axis=-1)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(out, 'ocean-foam.webp'), 'WEBP', quality=92, method=6)
    print('ocean maps written to', out, '| rms slope before gain', round(float(slope), 4),
          '| foam cover', round(float((foam > 0.3).mean()), 3))


main()
