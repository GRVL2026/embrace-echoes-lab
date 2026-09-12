#!/usr/bin/env python3
"""Rendu Blender headless d'un GLB sous N angles, fond transparent -> sprites PNG RGBA.

Reconstruit depuis la passation §4.4 (script glb_vues.py introuvable sur le Mac).
Lancement :
    /Applications/Blender.app/Contents/MacOS/Blender -b -P glb_vues.py -- modele.glb sortie/ 8

Pièges Blender 5.0.1 gérés (cf. §4.4) :
  - moteur = "BLENDER_EEVEE" (pas EEVEE_NEXT, qui n'existe plus dans l'énumération) ;
  - view_transform = "Standard" (AgX délave les rendus).
Réglages : film transparent, RGBA, focale 85 mm (peu de distorsion, cohérent avec les
packshots), élévation ~12° (plongée légère comme les photos catalogue).
Sprites nommés vue_000, vue_045, … par angle (azimut en degrés).
"""
import bpy, sys, os, math
from mathutils import Vector

# ---- arguments après "--" ----
argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 2:
    print("usage: blender -b -P glb_vues.py -- <modele.glb> <sortie/> [n_angles]")
    sys.exit(1)
GLB, OUTDIR = args[0], args[1]
N = int(args[2]) if len(args) > 2 else 8
RES_X, RES_Y = 1200, 1600           # portrait : les machines sont plus hautes que larges
LENS_MM, SENSOR = 85.0, 36.0
ELEV_DEG = 12.0
os.makedirs(OUTDIR, exist_ok=True)

# ---- scène vierge + import ----
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    print("ERREUR: aucun mesh importé depuis", GLB)
    sys.exit(2)

# ---- bounding box monde ----
mn = Vector((1e18, 1e18, 1e18))
mx = Vector((-1e18, -1e18, -1e18))
for o in meshes:
    for corner in o.bound_box:
        w = o.matrix_world @ Vector(corner)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
center = (mn + mx) / 2.0
radius = (mx - mn).length / 2.0 or 1.0

# ---- réglages de rendu ----
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
sc.render.film_transparent = True
sc.render.resolution_x = RES_X
sc.render.resolution_y = RES_Y
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"

# ---- éclairage : soleil + ambiance douce (l'IA relightera ensuite) ----
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 3.0
sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0.0, math.radians(35))
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.7

# ---- caméra 85 mm, distance calculée pour cadrer la sphère englobante ----
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = LENS_MM; cam_d.sensor_width = SENSOR
cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam

hfov = 2 * math.atan(SENSOR / (2 * LENS_MM))
aspect = RES_X / RES_Y
vfov = 2 * math.atan(math.tan(hfov / 2) / aspect)
half = min(hfov, vfov) / 2.0
DIST = radius / math.tan(half) * 1.18   # marge

elev = math.radians(ELEV_DEG)
for i in range(N):
    deg = round(i * 360.0 / N)
    az = math.radians(deg)
    d = Vector((math.cos(elev) * math.cos(az), math.cos(elev) * math.sin(az), math.sin(elev)))
    cam.location = center + d * DIST
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUTDIR, f"vue_{deg:03d}.png")
    bpy.ops.render.render(write_still=True)
    print(f"  rendu vue_{deg:03d}.png")

print(f"OK: {N} vues -> {OUTDIR}")
