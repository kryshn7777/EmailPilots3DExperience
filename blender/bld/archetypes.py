"""The ten buildings. Dimensions are real metres.

Ids matter to the site: `cityGen` sends modules whose id contains "sky" to the
tall lots (and to the whole window district), and everything else to the low
ones. `target` is the largest dimension in the site's kit units: the lot maths
in `cityGen.mjs` was tuned around kit modules whose longest side was 1.1-2.9,
so keeping each module in that band keeps the districts at their old scale.
"""
from .facade import GLASS_POOL
from .model import Model

TEAL_POOL = ['glass_teal'] * 4 + ['glass_mid'] * 3 + ['glass_sky'] * 2 + ['glass_dark']
BLUE_POOL = ['glass_mid'] * 4 + ['glass_sky'] * 3 + ['glass_dark'] * 2 + ['glass_teal']


def curtain(**kw):
    return dict(dict(kind='curtain', floor_h=4.0, bay=1.5, frame='frame_dark',
                     spandrel='spandrel', glass=GLASS_POOL, lit=0.28), **kw)


def punched(**kw):
    return dict(dict(kind='punched', floor_h=3.9, bay=2.5, wall='concrete', frame='frame_dark',
                     glass=GLASS_POOL, win_w=0.55, win_h=0.6, sill=0.2, depth=0.45, lit=0.3), **kw)


def louver(**kw):
    return dict(dict(kind='louver', mat='louver', frame='frame_dark', backing='spandrel'), **kw)


def shop(wall, bay=4.8, h=6.0, lit=0.5):
    return dict(h=h, wall=wall, bay=bay, lit=lit)


# ---- towers --------------------------------------------------------------------

def glass_a():
    m = Model('skyscraper-glass-a', 'tower', 2.9)
    body = curtain(floor_h=4.2, ground=shop('concrete_d', 5.0))
    m.tier(0, 0, 34, 28, 0, 138, body, chamfer=3.5,
           roof=dict(parapet=1.2, items=dict(ac=2.0, vent=2.0, skylight=0.6)))
    m.tier(0, 0, 24, 18, 138, 152, louver(), chamfer=2.5,
           roof=dict(parapet=0.9, items=dict(vent=2.0, ac=1.0)))
    m.wedge(0, 0, 14, 10, 152, 156, 166, 'louver', 'glass_sky')
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.volume(sx * 11.2, sy * 7.2, 1.4, 1.4, 152, 158, 'frame_dark')
    m.mast(0, 0, 166, 190, 0.7)
    return m


def glass_b():
    m = Model('skyscraper-glass-b', 'tower', 2.8)
    skin = lambda **kw: curtain(frame='frame_light', glass=TEAL_POOL, **kw)
    m.tier(0, 0, 40, 30, 0, 64, skin(ground=shop('concrete_d', 5.0)),
           roof=dict(parapet=1.1, items=dict(garden=1.8, ac=1.0, vent=1.0)))
    m.tier(0, 0, 32, 24, 64, 124, skin(), chamfer=2.5,
           roof=dict(parapet=1.1, items=dict(garden=1.2, solar=0.6, vent=1.0)))
    m.tier(0, 0, 22, 16, 124, 170, skin(), chamfer=2.0,
           roof=dict(parapet=1.0, items=dict(ac=1.5, vent=1.0)))
    m.tier(0, 0, 13, 9, 170, 176, louver(), roof=dict(parapet=0.6, margin=0.8))
    m.wedge(0, 0, 13, 9, 176, 176.5, 190, 'louver', 'glass_teal')
    m.mast(0, 0, 190, 214, 0.7)
    return m


def deco():
    m = Model('skyscraper-deco', 'tower', 2.9)
    skin = lambda **kw: dict(dict(kind='deco', floor_h=4.2, bay=2.4, wall='limestone',
                                  frame='frame_dark', glass=GLASS_POOL, lit=0.3), **kw)
    cornice = (1.0, 0.8, 'limestone')
    m.tier(0, 0, 42, 34, 0, 84, skin(ground=shop('limestone', 4.8, lit=0.55), cornice=cornice),
           roof=dict(parapet=1.1, mat='roof_tar', items=dict(ac=1.5, vent=2.0, skylight=0.5)))
    m.tier(0, 0, 32, 26, 84, 126, skin(cornice=cornice),
           roof=dict(parapet=1.0, mat='roof_tar', items=dict(ac=1.0, vent=1.5)))
    m.tier(0, 0, 23, 19, 126, 158, skin(cornice=cornice),
           roof=dict(parapet=0.9, mat='roof_tar', items=dict(vent=1.5)))
    m.tier(0, 0, 14, 12, 158, 180, skin(), roof=False)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.volume(sx * 10.5, sy * 8.5, 2.0, 2.0, 126, 134, 'limestone')
    m.pyramid(0, 0, 14, 12, 180, 200, 'metal_roof')
    m.mast(0, 0, 200, 226, 0.8)
    return m


def stone():
    m = Model('skyscraper-stone', 'tower', 2.6)
    a, b = 7.0, 19.0
    poly = [(-a, -b), (a, -b), (a, -a), (b, -a), (b, a), (a, a),
            (a, b), (-a, b), (-a, a), (-b, a), (-b, -a), (-a, -a)]
    keys = ['E', 'S', 'S', 'E', 'S', 'S', 'E', 'S', 'S', 'E', 'S', 'S']
    body = punched(floor_h=3.9, bay=2.3, trim='limestone', depth=0.5,
                   ground=shop('concrete_d', 4.5, h=5.5), cornice=(0.9, 0.6, 'concrete'))
    m.tier(0, 0, 0, 0, 0, 125, body, poly=poly, keys=keys, name='cross',
           roof=dict(parapet=1.1, items=dict(ac=1.5, vent=2.0, skylight=0.5, bulkhead=0.4)))
    m.tier(0, 0, 14, 14, 125, 138, louver(), chamfer=2.0, roof=dict(parapet=0.7, margin=0.8))
    m.volume(0, -15, 5.0, 4.0, 125, 130, 'concrete_d')
    m.volume(15, 0, 4.0, 5.0, 125, 129, 'concrete_d')
    m.tank(-15, 0, 125, r=1.8, h=2.8)
    m.mast(0, 0, 138, 162, 0.6)
    return m


def twin():
    m = Model('skyscraper-twin', 'tower', 2.7)
    m.tier(0, 0, 42, 28, 0, 92, curtain(ground=shop('concrete_d', 5.0)), chamfer=3.0,
           roof=dict(parapet=1.1, items=dict(ac=1.5, vent=1.5, garden=0.8)))
    m.tier(-12, 0, 15, 28, 92, 146, curtain(frame='frame_light', glass=BLUE_POOL), name='pl',
           roof=dict(parapet=0.9, items=dict(ac=1.5, vent=1.0)))
    m.mast(-12, 0, 146, 170, 0.6)
    m.tier(12, 0, 15, 28, 92, 138, curtain(frame='frame_light', glass=BLUE_POOL), name='pr',
           roof=False)
    m.wedge(12, 0, 15, 28, 138, 138, 156, 'louver', 'glass_sky')
    m.tier(0, 0, 9.2, 10, 116, 124, curtain(frame='frame_light', glass=BLUE_POOL, floor_h=4.0),
           name='bridge', roof=dict(parapet=0.4, margin=0.6))
    return m


def slab():
    m = Model('skyscraper-slab', 'tower', 2.3)
    body = dict(kind='ribbon', floor_h=3.2, bay=3.0, wall='plaster', slab='concrete',
                frame='frame_dark', glass=GLASS_POOL, balcony=1.3, solid_every=4, fin_every=6,
                lit=0.32, ground=shop('concrete_d', 4.5, h=5.0))
    m.tier(0, 0, 54, 19, 0, 96, body,
           roof=dict(parapet=1.0, items=dict(garden=1.5, solar=1.0, ac=1.5, vent=2.0)))
    m.tier(21, 0, 12, 19, 96, 108, louver(), roof=dict(parapet=0.7, margin=0.8))
    m.tier(-15, 15.5, 24, 12, 0, 38, dict(body, bay=3.0), name='wing',
           roof=dict(parapet=1.0, items=dict(garden=2.0, ac=1.0)))
    m.tank(-14, 2, 96)
    return m


def needle():
    """Supertall: a slim glass shaft that tapers in three steps to a long spire."""
    m = Model('skyscraper-needle', 'tower', 2.9)
    skin = lambda **kw: curtain(frame='frame_dark', glass=BLUE_POOL, **kw)
    m.tier(0, 0, 28, 28, 0, 96, skin(floor_h=4.0, ground=shop('concrete_d', 5.0)), chamfer=4.0,
           roof=dict(parapet=1.0, items=dict(ac=1.0, vent=1.0)))
    m.tier(0, 0, 23, 23, 96, 172, skin(floor_h=4.0), chamfer=3.5,
           roof=dict(parapet=1.0, items=dict(ac=1.0, vent=1.0)))
    m.tier(0, 0, 18, 18, 172, 214, skin(floor_h=3.8), chamfer=3.0,
           roof=dict(parapet=0.9, items=dict(vent=1.5)))
    m.tier(0, 0, 10, 10, 214, 222, louver(), chamfer=1.5, roof=dict(parapet=0.5, margin=0.6))
    m.mast(0, 0, 222, 262, 0.8)
    return m


def crown():
    """Classical office tower under a green copper pyramid."""
    m = Model('skyscraper-crown', 'tower', 2.7)
    body = punched(floor_h=3.9, bay=2.6, wall='limestone', trim='limestone', win_w=0.5,
                   win_h=0.62, depth=0.5, ground=shop('limestone', 5.2, h=6.0, lit=0.55),
                   cornice=(1.1, 1.0, 'limestone'), belt=(30.0, 0.5, 'limestone'))
    m.tier(0, 0, 36, 36, 0, 78, body, roof=dict(parapet=1.1, mat='roof_tar', items=dict(ac=1.5, vent=1.5)))
    m.tier(0, 0, 28, 28, 78, 128, dict(body, ground=None), roof=dict(parapet=1.0, mat='roof_tar', items=dict(ac=1.0)))
    m.tier(0, 0, 20, 20, 128, 150, dict(body, ground=None, belt=None), roof=False)
    m.pyramid(0, 0, 21, 21, 150, 176, 'copper')
    m.mast(0, 0, 176, 192, 0.6)
    return m


# ---- mid-rise blocks -----------------------------------------------------------

def brick():
    m = Model('block-brick', 'block', 1.35)
    body = punched(floor_h=3.8, bay=2.9, wall='brick_red', trim='limestone', win_w=0.5,
                   win_h=0.62, depth=0.4, ground=shop('brick_brn', 4.0, h=5.0, lit=0.6),
                   cornice=(1.1, 0.9, 'limestone'))
    m.tier(0, 0, 24, 18, 0, 34, body,
           roof=dict(parapet=0.9, parapet_mat='brick_red', items=dict(ac=2.0, vent=1.5, skylight=0.6)))
    m.tank(-6, -3, 34, r=2.0, h=3.0)
    m.volume(6, 3, 4.2, 3.4, 34, 36.8, 'concrete_d')
    return m


def podium():
    m = Model('block-podium', 'block', 1.7)
    base = punched(floor_h=4.0, bay=3.6, wall='concrete_d', trim='concrete', win_w=0.72,
                   win_h=0.7, ground=shop('concrete', 5.4, h=5.5, lit=0.6))
    m.tier(0, 0, 40, 30, 0, 16, base,
           roof=dict(parapet=1.0, items=dict(garden=2.5, ac=1.0, vent=1.0)))
    m.tier(4, 0, 24, 18, 16, 62, curtain(floor_h=3.6, frame='frame_light', glass=BLUE_POOL),
           chamfer=2.0, name='tower',
           roof=dict(parapet=0.9, items=dict(ac=1.5, vent=1.0)))
    m.volume(4, 0, 10, 8, 62, 66, 'concrete_d')
    return m


def loft():
    m = Model('block-loft', 'block', 1.25)
    body = dict(kind='steel', floor_h=4.25, bay=4.2, wall='brick_brn', frame='frame_dark',
                glass=GLASS_POOL, lit=0.3, ground=shop('brick_red', 4.2, h=5.0),
                cornice=(0.8, 0.6, 'concrete'))
    m.tier(0, 0, 30, 24, 0, 25.5, body, roof=False)
    m.sawtooth(0, 0, 30, 24, 25.5, 5, 2.6)
    m.stack(-10, -7, 25.5, 52, 1.3, 0.9, 'brick_red')
    return m


def mansard():
    m = Model('block-mansard', 'block', 1.15)
    body = punched(floor_h=3.7, bay=2.5, wall='limestone', trim='limestone', win_w=0.46,
                   win_h=0.68, sill=0.14, depth=0.35, ground=shop('limestone', 3.8, h=5.0),
                   cornice=(0.9, 0.8, 'limestone'))
    m.tier(0, 0, 28, 17, 0, 26, body, roof=False)
    m.mansard(0, 0, 28, 17, 26, 32.5, 2.6, dormers=(4, 3))
    for x, y in ((-8, -3), (2, 3), (9, -2)):
        m.volume(x, y, 1.5, 1.0, 32.5, 36.0, 'brick_red')
    return m


# order fixes each module's atlas tile
TOWERS = [glass_a, glass_b, deco, stone, twin, slab, needle, crown]
BLOCKS = [brick, podium, loft, mansard]
