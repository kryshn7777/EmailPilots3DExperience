"""Procedural bark strips, periodic around the trunk.

A tube's u runs once around its circumference, so the strip must wrap in x. Furrows
run along the trunk (stretched noise), ridges catch lighter, the occlusion map
darkens the furrows, and a species can add moss or the dark horizontal lenticels of
a poplar. Returns sRGB colour plus an occlusion/roughness/metalness strip.
"""
import numpy as np


def _noise(w, h, gx, gy, seed, wrap_y=False):
    r = np.random.default_rng(seed)
    lat = r.random((gy + 1, gx))
    ys = np.linspace(0, gy, h, endpoint=False)
    xs = np.linspace(0, gx, w, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % gy if wrap_y else y0 + 1
    a, b = lat[y0][:, x0 % gx], lat[y0][:, (x0 + 1) % gx]
    c, d = lat[y1][:, x0 % gx], lat[y1][:, (x0 + 1) % gx]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def _fbm(w, h, gx, gy, octaves, seed):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * _noise(w, h, gx * 2 ** o, gy * 2 ** o, seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


def _lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-8), 1 / 2.4) - 0.055)


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def bark(w, h, tint, seed, moss=0.0, lenticels=0.0, furrow=1.0):
    """(rgb uint8 (h, w, 3), orm uint8 (h, w, 3)) for one species."""
    # ridged noise: stretched along y so furrows run up the trunk
    ridge = 1.0 - np.abs(_fbm(w, h, 10, 5, 4, seed) * 2 - 1)
    ridge = ridge ** (1.6 * furrow)
    fine = _fbm(w, h, 40, 22, 3, seed + 31)
    height = np.clip(0.75 * ridge + 0.25 * fine, 0, 1)

    base = _lin(hex_rgb(tint))
    dark = base * 0.18
    light = base * 1.5
    t = height[..., None]
    col = dark + (light - dark) * np.clip(t * 1.25 - 0.1, 0, 1)
    col = col * (0.88 + 0.24 * _fbm(w, h, 6, 9, 3, seed + 77)[..., None])

    if moss > 0:
        m = np.clip((_fbm(w, h, 4, 3, 3, seed + 101) - (1 - moss)) * 5, 0, 1)[..., None]
        col = col * (1 - 0.65 * m) + _lin(np.array([0.22, 0.34, 0.12], np.float32)) * 0.65 * m * (0.5 + height[..., None])
    if lenticels > 0:
        # short dark horizontal dashes, as on birch and poplar
        d = _fbm(w, h, 28, 90, 1, seed + 211)
        dash = (d > 1 - lenticels * 0.35).astype(np.float32)[..., None]
        col = col * (1 - 0.7 * dash)

    ao = 0.45 + 0.55 * np.clip(height * 1.4, 0, 1)
    orm = np.stack([ao, np.full_like(ao, 0.92), np.zeros_like(ao)], axis=-1)
    to8 = lambda a: np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    return to8(_srgb(col)), to8(orm)
