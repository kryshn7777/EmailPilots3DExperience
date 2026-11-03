"""Where the openings are on every house, for the runtime's weathering decals.

    python blender/make_anchors.py

Builds each house's description (no baking: it only needs the walls), and writes
public/models/homes/anchors.json: per module id, the windows (`win`) and garage doors (`gar`) as
`[x, y, z, nx, nz, ux, uz, width, height]`, in the module's own site units with the glTF axes the
GLBs use (y up, the module centred on its footprint, standing on y = 0): the position is the bottom
centre of the opening on the wall plane, (nx, nz) the wall's outward normal and (ux, uz) the way
along the wall, and width and height are in site units. src/webgl/actors/HouseDecals.ts reads it.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from bld import homes  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'models', 'homes', 'anchors.json')


def main():
    s = homes.SCALE
    out = {}
    for fn in homes.HOUSES:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        m = fn()
        m.finish()
        rows = []
        for a in m.hp.anchors:
            p, n, u = a['p'], a['n'], a['u']
            # blender (x, y, z up) -> glTF (x, z, -y)
            rows.append([a['k'], round(p.x * s, 4), round(p.z * s, 4), round(-p.y * s, 4),
                         round(n.x, 4), round(-n.y, 4), round(u.x, 4), round(-u.y, 4),
                         round(a['w'] * s, 4), round(a['h'] * s, 4)])
        out[m.id] = rows
        print(m.id, len(rows), 'openings')
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
