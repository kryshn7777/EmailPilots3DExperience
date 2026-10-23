"""The homes: twelve houses and four trees for the district outside the window.

Dimensions are real metres. Every module is exported at SCALE site units per
metre, so a house keeps its true proportions against its neighbours and the lot
generator (`homeLots` in cityGen.mjs) only has to jitter a size, not pick one.
"""
from .house import (chimney, door, dormer, garage, house_block, porch, row, win)
from .model import Model
from .trees import maple, oak, pine, poplar

SCALE = 0.33   # site units per metre


def S(wall, **kw):
    """A wall spec with the house defaults."""
    return dict(dict(wall=wall, found=(0.5, 'concrete_d'), floor_h=2.7, trim='trim_white',
                     lit=0.32, grille=(2, 2), boxes=0.0), **kw)


def gable_end(wall, L, floors=1, fh=2.7, **kw):
    """E/W wall of a house: windows centred on the wall, every floor."""
    opens = [win(L / 2, f, w=1.0, h=1.4) for f in range(floors)]
    return S(wall, floor_h=fh, openings=opens, attic=True, **kw)


def plain(wall, **kw):
    return S(wall, corners=False, **kw)


# ---- houses --------------------------------------------------------------------

def cottage():
    m = Model('home-cottage', 'house', scale=SCALE)
    w, d, ze, pitch = 8.0, 6.0, 2.6, 0.85
    wall = 'siding_cream'
    house_block(
        m, 0, 0, w, d, 0, ze,
        dict(S=S(wall, boxes=0.9, openings=[win(1.5, w=1.1, shutters=True), door(w / 2),
                                            win(w - 1.5, w=1.1, shutters=True)]),
             E=S(wall, attic=True, openings=[win(1.3, w=0.9), win(d - 1.3, w=0.9)]), W=gable_end(wall, d),
             N=S(wall, boxes=0.7, openings=[win(1.5, w=1.0, shutters=True), door(w / 2 + 0.6, mat='door_green'),
                                            win(w - 1.3, w=1.0, shutters=True)])),
        dict(kind='gable', mat='shingle_brn_hi', pitch=pitch, oh=0.45, rake=0.3), 'b')
    porch(m, 0, -d / 2 - 0.9, 3.0, 1.8, 2.5, posts=2, roof_mat='shingle_brn')
    chimney(m, w / 2 + 0.45, 0.4, 0.9, 1.5, 0, ze + d / 2 * pitch + 0.9)
    return m


def colonial():
    m = Model('home-colonial', 'house', scale=SCALE)
    w, d, fh, pitch = 11.0, 8.5, 2.8, 0.5
    ze = 2 * fh
    wall = 'brick_h_red'
    sh = dict(shutters=True, w=1.0, h=1.5)
    front = S(wall, floor_h=fh, grille=(3, 2), boxes=0.5, openings=(
        [win(u, 0, **sh) for u in (1.9, 3.6, 7.4, 9.1)] + [door(w / 2, mat='door_blue')] +
        [win(u, 1, **sh) for u in (1.9, 3.6, w / 2, 7.4, 9.1)]))
    back = S(wall, floor_h=fh, boxes=0.4, openings=row(w, 4, 0, w=1.0, skip=(2,)) + [door(6.55, mat='door_blue')] +
             row(w, 4, 1, w=1.0))
    end = S(wall, floor_h=fh, attic=True, openings=[win(u, f, w=1.0, h=1.4) for f in range(2) for u in (2.0, d - 2.0)])
    house_block(m, 0, 0, w, d, 0, ze, dict(S=front, E=end, W=end, N=back),
                dict(kind='gable', mat='shingle_blk', pitch=pitch, oh=0.5, rake=0.25), 'b')
    porch(m, 0, -d / 2 - 1.0, 3.4, 2.0, 3.6, posts=2, roof_mat='shingle_blk')
    top = ze + d / 2 * pitch + 1.0
    chimney(m, w / 2 + 0.45, 0, 0.9, 1.7, 0, top)
    chimney(m, -w / 2 - 0.45, 0, 0.9, 1.7, 0, top)
    return m


def ranch():
    m = Model('home-ranch', 'house', scale=SCALE)
    w, d, ze, pitch = 11.0, 8.0, 2.9, 0.36
    wall = 'siding_gray'
    front = S(wall, grille=None, boxes=0.4, openings=[win(1.7, w=1.1), win(4.2, w=1.9, h=1.5),
                                                      door(7.2, mat='door_red'), win(9.6, w=1.1)],
              shutter='shutter')
    house_block(m, 0, 0, w, d, 0, ze,
                dict(S=front, E=plain(wall, openings=[win(d / 2)]), W=plain(wall),
                     N=S(wall, openings=row(w, 4, 0, w=1.0))),
                dict(kind='hip', mat='shingle_gray', pitch=pitch, oh=0.6), 'b')
    gx = -w / 2 - 5.8 / 2 + 0.2
    house_block(m, gx, -d / 2 + 3.3, 5.8, 6.6, 0, 2.7,
                dict(S=S(wall, openings=[garage(2.9)]), E=plain(wall),
                     N=plain(wall), W=gable_end(wall, 6.6)),
                dict(kind='gable', mat='shingle_gray', pitch=0.5, oh=0.5, rake=0.3), 'g',
                ridge='y')
    chimney(m, 2.0, 0.6, 0.8, 0.8, ze, ze + 4 * pitch + 1.4)
    return m


def farmhouse():
    m = Model('home-farmhouse', 'house', scale=SCALE)
    w, d, fh, pitch = 9.0, 7.5, 2.7, 0.75
    ze = 2 * fh
    wall = 'siding_white'
    front = S(wall, floor_h=fh, attic=True, boxes=0.5, openings=(
        [win(2.0, 0, w=1.0, h=1.6), door(w / 2, mat='door_green'), win(7.0, 0, w=1.0, h=1.6)] +
        [win(u, 1, w=0.9, h=1.5) for u in (2.2, w / 2, 6.8)]))
    side = gable_end(wall, d, floors=2, fh=fh)
    house_block(m, 0, 0, w, d, 0, ze, dict(S=front, E=side, W=side, N=plain(wall, attic=True)),
                dict(kind='gable', mat='metal_seam_dk', pitch=pitch, oh=0.55, rake=0.3), 'b',
                ridge='y')
    house_block(m, 0.5, d / 2 + 2.2, 6.0, 5.0, 0, 2.7,
                dict(S=plain(wall), E=gable_end(wall, 5.0), W=gable_end(wall, 5.0),
                     N=S(wall, openings=row(6.0, 2, 0, w=1.0))),
                dict(kind='gable', mat='metal_seam_dk', pitch=0.7, oh=0.45, rake=0.3), 'w')
    porch(m, 0, -d / 2 - 1.1, w + 1.2, 2.2, 2.7, posts=5, roof_mat='metal_seam_dk')
    chimney(m, 1.6, 0.2, 0.9, 0.9, ze, ze + 4.5 * pitch + 0.8)
    return m


def craftsman():
    m = Model('home-craftsman', 'house', scale=SCALE)
    w, d, ze, pitch = 12.0, 8.5, 3.2, 0.38
    wall = 'siding_sage'
    front = S(wall, found=(1.0, 'fieldstone'), floor_h=3.0, trim='trim_white', grille=(3, 1, 'top'), openings=[
        win(1.8, w=1.8, h=1.5, sill=1.0), win(4.0, w=1.8, h=1.5, sill=1.0),
        door(7.4, mat='door_red'), win(10.3, w=1.1, h=1.5, sill=1.0)])
    house_block(m, 0, 0, w, d, 0, ze,
                dict(S=front, E=gable_end(wall, d, found=(1.0, 'fieldstone')),
                     W=S(wall, found=(1.0, 'fieldstone'), attic=True, grille=(3, 1, 'top'),
                         openings=[win(1.9, w=1.1, sill=1.0), win(d - 1.9, w=1.1, sill=1.0)]),
                     N=S(wall, found=(1.0, 'fieldstone'), openings=row(w, 4, 0, w=1.1, sill=1.0))),
                dict(kind='gable', mat='shingle_brn', pitch=pitch, oh=0.95, rake=0.6), 'b')
    dormer(m, 0, 0, d, ze, pitch, 'dorm', 'shingle_brn', 'siding_sage', width=2.6)
    porch(m, 3.0, -d / 2 - 1.2, 7.0, 2.4, 2.6, posts=3, roof_mat='shingle_brn')
    chimney(m, -w / 2 - 0.45, 0, 0.9, 1.6, 0, ze + d / 2 * pitch + 1.0, mat='fieldstone')
    return m


def victorian():
    m = Model('home-victorian', 'house', scale=SCALE)
    w, d, fh, pitch = 8.5, 7.5, 2.9, 0.95
    ze = 2 * fh
    tall = dict(w=0.9, h=1.8, sill=0.55)
    front = S('siding_blue', floor_h=fh, attic=True, grille=(1, 2), boxes=0.4, openings=(
        [win(1.8, 0, **tall), door(w / 2, mat='door_red'), win(w - 1.8, 0, **tall)] +
        [win(u, 1, **tall) for u in (1.8, w / 2, w - 1.8)]))
    side = gable_end('siding_blue', d, floors=2, fh=fh)
    back = S('siding_blue', floor_h=fh, attic=True, grille=(1, 2), boxes=0.5, openings=(
        [win(1.8, 0, shutters=True, **tall), door(w / 2, mat='door_blue'), win(w - 1.8, 0, shutters=True, **tall)] +
        [win(u, 1, **tall) for u in (1.8, w - 1.8)]))
    house_block(m, 0, 0, w, d, 0, ze, dict(S=front, E=side, W=side, N=back),
                dict(kind='gable', mat='shingle_gray_hi', pitch=pitch, oh=0.5, rake=0.3), 'b',
                ridge='y')
    wing = gable_end('siding_cream', 4.5, floors=2, fh=fh)
    house_block(m, w / 2 + 1.6, -0.8, 6.5, 4.5, 0, ze,
                dict(S=S('siding_cream', floor_h=fh, openings=row(6.5, 2, 0, w=0.9, h=1.8, sill=0.55)
                         + row(6.5, 2, 1, w=0.9, h=1.8, sill=0.55)),
                     E=wing, W=plain('siding_cream'), N=plain('siding_cream')),
                dict(kind='gable', mat='shingle_gray_hi', pitch=pitch, oh=0.45, rake=0.3), 'x')
    porch(m, -1.0, -d / 2 - 1.1, 5.5, 2.2, 2.9, posts=3, roof_mat='shingle_gray')
    chimney(m, -w / 2 + 1.3, 1.0, 0.9, 0.9, ze, ze + 4.25 * pitch + 1.2)
    return m


def terrace():
    m = Model('home-terrace', 'house', scale=SCALE)
    unit, d, fh = 5.0, 9.0, 2.9
    ze = 3 * fh
    mats = ['brick_h_red', 'brick_h_brn', 'stucco_cream', 'siding_gray']
    doors = ['door_blue', 'door_red', 'door_green', 'door_red']

    def unit_front(mat, dr):
        return S(mat, floor_h=fh, openings=(
            [door(1.1, w=0.95, mat=dr), win(3.5, 0, w=1.1)] +
            [win(u, f, w=1.0, h=1.6) for f in (1, 2) for u in (1.3, 3.6)]))

    front = dict(segments=[(unit, unit_front(mt, dr)) for mt, dr in zip(mats, doors)])
    back = dict(segments=[(unit, S(mt, floor_h=fh, openings=row(unit, 1, 0) + row(unit, 1, 1) +
                                   row(unit, 1, 2))) for mt in mats])
    end = lambda mt: S(mt, floor_h=fh, openings=[win(d / 2, f, w=1.0, h=1.5) for f in range(3)])
    house_block(m, 0, 0, 4 * unit, d, 0, ze,
                dict(S=front, E=end(mats[-1]), W=end(mats[0]), N=back),
                dict(kind='flat', flat=dict(parapet=0.9, mat='roof_tar', margin=1.0,
                                            items=dict(vent=4.0, ac=1.0, skylight=1.5))), 'b')
    return m


def modern():
    m = Model('home-modern', 'house', scale=SCALE)
    lower = S('stucco_white', floor_h=3.1, trim='trim_dark', corners=False, found=(0.3, 'concrete_d'), grille=None,
              openings=[win(2.4, w=3.2, h=2.3, sill=0.3), door(6.4, w=1.2, mat='door_blue'),
                        win(10.6, w=3.2, h=2.3, sill=0.3)], lit=0.5)
    flat = dict(kind='flat', flat=dict(parapet=0.35, mat='roof_membrane', margin=0.8,
                                       items=dict(solar=2.0, vent=1.5, skylight=1.5)))
    house_block(m, 0, 0, 14, 9, 0, 3.1,
                dict(S=lower, E=plain('stucco_white', grille=None, openings=[win(4.5, w=2.2, h=2.0, sill=0.5)]),
                     W=plain('stucco_white'),
                     N=plain('stucco_white', grille=None, openings=row(14, 3, 0, w=2.2, h=2.0, sill=0.5))),
                flat, 'b')
    upper = S('deck_wood', floor_h=3.1, trim='trim_dark', corners=False, found=(0.0, 'deck_wood'), grille=None,
              openings=[win(4.2, 0, w=5.6, h=1.5, sill=0.9)], lit=0.55)
    house_block(m, 1.5, -2.0, 9, 8, 3.1, 6.2,
                dict(S=upper, E=plain('deck_wood', found=(0.0, 'deck_wood'), grille=None,
                                      openings=[win(4, 0, w=3.0, h=1.5, sill=0.9)]),
                     W=plain('deck_wood', found=(0.0, 'deck_wood')),
                     N=plain('deck_wood', found=(0.0, 'deck_wood'))),
                flat, 'u')
    return m


def bungalow():
    m = Model('home-bungalow', 'house', scale=SCALE)
    w, d, ze, pitch = 8.5, 7.0, 2.8, 0.6
    wall = 'siding_ochre'
    house_block(m, 0, 0, w, d, 0, ze,
                dict(S=S(wall, attic=True, boxes=0.8, grille=(3, 1, 'top'),
                         openings=[win(1.6, w=1.1), door(w / 2, mat='door_green'), win(w - 1.6, w=1.1)]),
                     E=S(wall, openings=row(d, 2, 0, w=1.0)), W=S(wall, openings=row(d, 2, 0, w=1.0)),
                     N=S(wall, attic=True, boxes=0.6, grille=(3, 1, 'top'),
                         openings=[win(1.6, w=1.0), door(w / 2 + 0.4, mat='door_red'), win(w - 1.5, w=1.0)])),
                dict(kind='gable', mat='shingle_gray', pitch=pitch, oh=0.6, rake=0.35), 'b',
                ridge='y')
    porch(m, 0, -d / 2 - 1.2, w, 2.4, 2.6, posts=4, roof_mat='shingle_gray')
    chimney(m, w / 2 + 0.45, 0.5, 0.9, 1.4, 0, ze + w / 2 * pitch + 0.9)
    return m


def suburban():
    m = Model('home-suburban', 'house', scale=SCALE)
    w, d, fh = 10.0, 8.0, 2.65
    ze = 2 * fh
    wall = 'siding_sage'
    front = S(wall, floor_h=fh, boxes=0.4, openings=(
        [win(1.8, 0, w=1.4), door(5.6, mat='door_red'), win(8.4, 0, w=1.0)] +
        [win(u, 1, w=1.0, h=1.4) for u in (1.8, 4.1, 6.4, 8.6)]), shutter='shutter')
    house_block(m, 0, 0, w, d, 0, ze,
                dict(S=front, E=S(wall, floor_h=fh, attic=True,
                                  openings=[win(u, f, w=1.0, h=1.4) for f in range(2) for u in (1.9, d - 1.9)]),
                     W=plain(wall),
                     N=S(wall, floor_h=fh, openings=row(w, 4, 0, w=1.0) + row(w, 4, 1, w=1.0))),
                dict(kind='gable', mat='shingle_gray', pitch=0.5, oh=0.55, rake=0.3), 'b')
    house_block(m, -w / 2 - 3.0 + 0.2, -d / 2 + 3.5, 6.0, 7.0, 0, 2.8,
                dict(S=S(wall, openings=[garage(3.0, w=4.9)]), E=plain(wall), N=plain(wall),
                     W=gable_end(wall, 7.0)),
                dict(kind='gable', mat='shingle_gray', pitch=0.5, oh=0.5, rake=0.3), 'g',
                ridge='y')
    porch(m, 1.0, -d / 2 - 0.9, 3.4, 1.8, 2.5, posts=2, roof_mat='shingle_gray')
    chimney(m, w / 2 + 0.45, -0.5, 0.9, 1.5, 0, ze + d / 2 * 0.5 + 1.0)
    return m


def tudor():
    m = Model('home-tudor', 'house', scale=SCALE)
    w, d, fh, pitch = 10.0, 8.5, 2.9, 1.0
    ze = 2 * fh
    stucco = 'stucco_cream'
    front = S(stucco, floor_h=fh, trim='trim_dark', timber=(fh, ze), attic=True, grille=(3, 3), boxes=0.6, openings=(
        [win(2.0, 0, w=1.2, h=1.5), door(w / 2, mat='door_red', w=1.1), win(8.0, 0, w=1.2, h=1.5)] +
        [win(u, 1, w=1.0, h=1.4, sill=0.5) for u in (2.0, 4.0, 6.0, 8.0)]))
    side = S(stucco, floor_h=fh, trim='trim_dark', timber=(fh, ze), attic=True, grille=(3, 3), boxes=0.6,
             openings=[win(u, f, w=1.2, h=1.4, sill=0.8 if f else 0.9) for f in range(2) for u in (1.9, d - 1.9)])
    back = S(stucco, floor_h=fh, trim='trim_dark', timber=(fh, ze), attic=True, grille=(3, 3), boxes=0.6, openings=(
        [win(2.2, 0, w=1.2, h=1.5), door(w / 2, mat='door_green', w=1.0), win(w - 2.2, 0, w=1.2, h=1.5)] +
        [win(u, 1, w=1.0, h=1.4, sill=0.5) for u in (2.5, w - 2.5)]))
    house_block(m, 0, 0, w, d, 0, ze, dict(S=front, E=side, W=side, N=back),
                dict(kind='gable', mat='shingle_brn_hi', pitch=pitch, oh=0.45, rake=0.3,
                     fascia='trim_dark'), 'b', ridge='y')
    chimney(m, -w / 2 - 0.45, 0, 1.0, 1.8, 0, ze + w / 2 * pitch + 0.6, mat='brick_h_brn')
    return m


def duplex():
    m = Model('home-duplex', 'house', scale=SCALE)
    unit, d, fh = 6.0, 8.5, 2.75
    ze = 2 * fh

    def unit_front(mat, mirror):
        du = unit - 1.1 if mirror else 1.1
        wu = (1.9, 4.0) if not mirror else (unit - 1.9, unit - 4.0)
        return S(mat, floor_h=fh, openings=(
            [door(du, w=0.95, mat='door_blue' if not mirror else 'door_red')] +
            [win(wu[0], 0, w=1.0, h=1.5)] + [win(u, 1, w=1.0, h=1.4) for u in (1.5, 4.5)]))

    front = dict(segments=[(unit, unit_front('brick_h_brn', False)),
                           (unit, unit_front('brick_h_red', True))])
    end = gable_end('brick_h_brn', d, floors=2, fh=fh)
    house_block(m, 0, 0, 2 * unit, d, 0, ze,
                dict(S=front, E=end, W=end,
                     N=S('brick_h_brn', floor_h=fh, openings=row(2 * unit, 4, 0) + row(2 * unit, 4, 1))),
                dict(kind='hip', mat='shingle_blk', pitch=0.4, oh=0.5), 'b')
    chimney(m, -2.5, 0.4, 0.8, 0.8, ze, ze + 4.25 * 0.4 + 1.1)
    chimney(m, 2.5, 0.4, 0.8, 0.8, ze, ze + 4.25 * 0.4 + 1.1)
    return m


HOUSES = [cottage, colonial, ranch, farmhouse, craftsman, victorian, terrace, modern,
          bungalow, suburban, tudor, duplex]
TREES = [oak, maple, pine, poplar]
