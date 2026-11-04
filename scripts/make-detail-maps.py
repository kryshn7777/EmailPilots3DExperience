"""Detail maps for the town's ground and walls, from public-domain photo PBR textures.

The ground and the house atlases are baked at a few centimetres a texel, so the grain of real asphalt,
concrete and plaster (millimetres) cannot be baked in; it is tiled over them at runtime instead (see
materials/Lawns.ts and materials/Roofs.ts). A detail map holds only the *variation* of a photograph: each
channel is divided by its own mean and stored at half scale (mean 0.5), so the shader multiplies by
`texel * 2.0` and the average colour of the surface stays what the bake says it is.

Sources are ambientCG textures (CC0 1.0; https://ambientcg.com), here from the public repository
github.com/itz019/tls-textures, which holds 1024 px colour maps of them:

    python3 scripts/make-detail-maps.py /path/to/tls-textures

Writes public/models/homes/detail-{asphalt,concrete,plaster}.webp (512 px, seamless as the sources are).
"""
import os
import sys

import numpy as np
from PIL import Image

SOURCES = {
    'asphalt': 'street_asphalt_Color.png',
    'concrete': 'sidewalk_concrete_Color.png',
    'plaster': 'wall_plaster_dirty_Color.png',
}
SIZE = 512


def main():
    src = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'homes')
    for name, file in SOURCES.items():
        im = Image.open(os.path.join(src, file)).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32) / 255.0
        lin = a ** 2.2
        # variation about the mean, per channel, then back to a display-encoded half-scale map
        ratio = lin / np.maximum(lin.reshape(-1, 3).mean(0), 1e-4)
        ratio = np.clip(ratio, 0.0, 2.0)
        enc = (ratio * 0.5).clip(0, 1)
        Image.fromarray((enc * 255).astype(np.uint8)).save(os.path.join(out, f'detail-{name}.webp'), 'WEBP', quality=90, method=6)
        print(name, 'mean', enc.reshape(-1, 3).mean(0).round(3), 'min/max', enc.min().round(3), enc.max().round(3))


if __name__ == '__main__':
    main()
