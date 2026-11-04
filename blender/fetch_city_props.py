"""Downloads the Poly Haven (CC0) source models the night city's street props are baked from.

    python blender/fetch_city_props.py [CACHE_DIR]      # default blender/cache/polyhaven (git-ignored)

Each asset lands as <cache>/<id>/<id>_1k.gltf with its .bin and 1k textures, plus info.json (the API's
record: name, authors). Poly Haven licenses every asset CC0 (https://polyhaven.com/license);
`make_city_props.py` writes the credits from info.json. Existing downloads are kept.
"""
import json
import os
import sys
import urllib.request

UA = {'User-Agent': 'EmailPilots3D-city-props/1.0 (+https://github.com)'}
ASSETS = [
    'fire_hydrant', 'metal_trash_can', 'trashbag', 'exterior_aircon_unit', 'utility_box_01', 'utility_box_02',
    'concrete_road_barrier_02', 'barrel_03', 'wooden_crate_02', 'plastic_crate_02', 'cardboard_box_01', 'old_tyre',
    'standing_chalkboard_01', 'WetFloorSign_01', 'CoffeeCart_01', 'planter_box_01', 'propane_tank',
    'plastic_monobloc_chair_01', 'modular_airduct_circular_01',
]
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def fetch(asset: str, cache: str) -> None:
    out = os.path.join(cache, asset)
    gltf = os.path.join(out, f'{asset}_1k.gltf')
    if os.path.exists(gltf):
        return
    os.makedirs(out, exist_ok=True)
    info = json.loads(get(f'https://api.polyhaven.com/info/{asset}'))
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
    entry = files['gltf']['1k']['gltf']
    for rel, inc in entry.get('include', {}).items():
        path = os.path.normpath(os.path.join(out, rel))
        assert path.startswith(out), rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(get(inc['url']))
    with open(gltf, 'wb') as f:
        f.write(get(entry['url']))
    with open(os.path.join(out, 'info.json'), 'w') as f:
        json.dump({'id': asset, 'name': info.get('name'), 'authors': list(info.get('authors', {}).keys()),
                   'url': f'https://polyhaven.com/a/{asset}', 'license': 'CC0'}, f, indent=1)
    print('fetched', asset)


if __name__ == '__main__':
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'cache', 'polyhaven')
    for a in ASSETS:
        try:
            fetch(a, cache)
        except Exception as e:  # noqa: BLE001
            print('[skip]', a, e)
