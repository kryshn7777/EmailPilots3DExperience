# Office props: sources

Every prop in `office-props.glb` is modelled procedurally in Blender by `blender/make_it_office.py`
(`blender/bld/office.py`, `office_mats.py`, `office_bake.py`), and all its textures are baked from
those models. **No third-party models or textures are used.**

Before modelling, the CC0 catalogue at Poly Haven (api.polyhaven.com, all assets CC0 per
polyhaven.com/license) was surveyed for the `electronics`, `furniture`, `office` and `props`
categories. Nothing there clearly beat a purpose-built prop for this room:

| candidate | why not |
| --- | --- |
| `potted_plant_01`, `potted_plant_02` | terracotta garden pots, not an office floor planter; leaves are alpha-tested cards, which would need a second (masked) material outside the shared opaque atlas |
| `retro_multimeter`, `classic_laptop`, `television_02` | period pieces, wrong for a modern IT bench |
| `metal_office_desk`, `SchoolChair_01`, `modern_arm_chair_01` | not a sit-stand desk pod or a task chair |
| `circuit_board`, `stationery_supplies`, `office_notepads` | 4k to 14k triangles each for detail that bakes into a few lean faces of our own |

If a CC0 asset is added later, credit it here and in the README's office section.
