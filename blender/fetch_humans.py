"""Fetches what blender/make_humans.py builds the people from, into blender/cache/makehuman/:

    mpfb2/                        MPFB2 (GPL-3 code, CC0 data: base mesh, targets, rigs, weights)
                                  https://github.com/makehumancommunity/mpfb2
    makehuman_system_assets/      the MakeHuman system assets (CC0: skins, eyes, eyebrows,
                                  eyelashes, hair, clothes, shoes)
                                  https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html

    python blender/fetch_humans.py

Nothing of MPFB's code ships; only meshes and textures derived from the CC0 data do.
"""
import os
import subprocess
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'blender', 'cache', 'makehuman')
MPFB = 'https://github.com/makehumancommunity/mpfb2.git'
ASSETS = ('https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/'
          'makehuman_system_assets_cc0.zip')


def main():
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, 'mpfb2')
    if not os.path.exists(dst):
        subprocess.run(['git', 'clone', '--depth', '1', MPFB, dst], check=True)
    sys_dir = os.path.join(CACHE, 'makehuman_system_assets')
    if not os.path.exists(sys_dir):
        z = os.path.join(CACHE, 'makehuman_system_assets_cc0.zip')
        if not os.path.exists(z):
            print('downloading', ASSETS)
            urllib.request.urlretrieve(ASSETS, z)
        with zipfile.ZipFile(z) as f:
            f.extractall(sys_dir)
    print('ok:', os.listdir(CACHE))


main()
