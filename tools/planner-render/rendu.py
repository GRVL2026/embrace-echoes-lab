#!/usr/bin/env python3
"""Projection perspective + salle nue (lancer de rayons numpy) + composite des sprites.

Reconstruit depuis la passation §3 (rendu.py d'origine introuvable). Sert de RÉFÉRENCE :
l'archi retenue (option A) portera cette projection + ce composite CÔTÉ NAVIGATEUR (canvas),
et une edge Deno minimale appellera Krea pour la passe photoréaliste. Ce script permet de
valider la géométrie en local et de comparer au rendu validé le 11/09.

Repère monde : X = largeur, Y = profondeur, Z = hauteur, en mètres, origine dans un coin.
Réglages validés : HFOV 68° (~24 mm), caméra à 1,70 m, visant ~1,35 m vers le fond.
"""
import numpy as np
from PIL import Image, ImageFilter

# --------------------------------------------------------------------------- caméra
def camera_basis(CAM, TGT):
    fwd = _n(np.array(TGT, float) - np.array(CAM, float))
    right = _n(np.cross(fwd, (0, 0, 1)))
    up = np.cross(right, fwd)
    return fwd, right, up

def _n(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) + 1e-12)

def project(P, CAM, right, up, fwd, W, H, FPX):
    """Point monde -> (x_px, y_px, profondeur) ou None si derrière la caméra."""
    v = np.asarray(P, float) - np.asarray(CAM, float)
    xc, yc, zc = v @ right, v @ up, v @ fwd
    if zc <= 0:
        return None
    return (W / 2 + FPX * xc / zc, H / 2 - FPX * yc / zc, zc)

# ------------------------------------------------------------------- salle nue (raytrace)
def render_room(W, H, room, CAM, TGT, HFOV):
    """Salle béton (sol + 4 murs + plafond) par lancer de rayons vectorisé numpy.
    room = (LX, LY, LZ) en mètres. Renvoie une image RGBA (numpy uint8)."""
    LX, LY, LZ = room
    fwd, right, up = camera_basis(CAM, TGT)
    FPX = (W / 2) / np.tan(HFOV / 2)
    # direction de chaque rayon (grille pixel -> monde)
    i, j = np.meshgrid(np.arange(W), np.arange(H))
    xc = (i - W / 2) / FPX
    yc = -(j - H / 2) / FPX
    dirs = (fwd[None, None, :] + xc[..., None] * right[None, None, :] + yc[..., None] * up[None, None, :])
    dirs /= np.linalg.norm(dirs, axis=2, keepdims=True)
    O = np.array(CAM, float)
    best_t = np.full((H, W), np.inf)
    shade = np.zeros((H, W))
    planes = [  # (point sur le plan, normale, teinte de base)
        ((0, 0, 0), (0, 0, 1), 0.55),   # sol
        ((0, 0, LZ), (0, 0, -1), 0.75), # plafond
        ((0, 0, 0), (1, 0, 0), 0.62),   # mur x=0
        ((LX, 0, 0), (-1, 0, 0), 0.62), # mur x=LX
        ((0, 0, 0), (0, 1, 0), 0.60),   # mur y=0
        ((0, LY, 0), (0, -1, 0), 0.60), # mur y=LY
    ]
    for pt, nrm, base in planes:
        pt = np.array(pt, float); nrm = np.array(nrm, float)
        denom = dirs @ nrm
        with np.errstate(divide="ignore", invalid="ignore"):
            t = ((pt - O) @ nrm) / denom
        hit = O + t[..., None] * dirs
        inside = (
            (t > 1e-3) & (t < best_t)
            & (hit[..., 0] > -1e-3) & (hit[..., 0] < LX + 1e-3)
            & (hit[..., 1] > -1e-3) & (hit[..., 1] < LY + 1e-3)
            & (hit[..., 2] > -1e-3) & (hit[..., 2] < LZ + 1e-3)
        )
        best_t = np.where(inside, t, best_t)
        shade = np.where(inside, base, shade)
    # ombrage par distance + léger grain
    fog = np.clip(1.0 - (best_t / (best_t[np.isfinite(best_t)].max() + 1e-6)) * 0.45, 0.4, 1.0)
    lum = np.clip(shade * fog, 0, 1)
    lum += (np.random.default_rng(7).random((H, W)) - 0.5) * 0.02
    rgb = (np.clip(lum, 0, 1)[..., None] * np.array([180, 178, 175])).astype(np.uint8)
    a = np.full((H, W, 1), 255, np.uint8)
    return np.concatenate([rgb, a], axis=2)

# ------------------------------------------------------------------------- composite
def alpha_crop(sprite):
    """Recadre le PNG sur sa boîte alpha (les packshots ont beaucoup de vide)."""
    a = np.asarray(sprite.split()[-1])
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return sprite
    return sprite.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def composite(room_rgba, machines, CAM, TGT, HFOV):
    """machines = liste de dict {x, y, height, sprite(PIL)} en mètres, x/y = contact sol.
    Algorithme du peintre : du plus loin au plus proche."""
    H, W = room_rgba.shape[:2]
    fwd, right, up = camera_basis(CAM, TGT)
    FPX = (W / 2) / np.tan(HFOV / 2)
    img = Image.fromarray(room_rgba, "RGBA")

    def depth(m):
        return np.linalg.norm(np.array([m["x"], m["y"], 0.0]) - np.array(CAM, float))

    for m in sorted(machines, key=depth, reverse=True):
        base = project((m["x"], m["y"], 0), CAM, right, up, fwd, W, H, FPX)
        top = project((m["x"], m["y"], m["height"]), CAM, right, up, fwd, W, H, FPX)
        if base is None or top is None:
            continue
        bx, by, _ = base
        _, ty, _ = top
        px_h = by - ty                       # hauteur du sprite en px = garantit l'échelle
        if px_h <= 2:
            continue
        spr = alpha_crop(m["sprite"])
        ratio = spr.width / spr.height
        px_w = px_h * ratio
        spr = spr.resize((max(1, int(px_w)), max(1, int(px_h))), Image.LANCZOS)
        # ombre de contact (ellipse floue) pour ancrer la machine au sol
        sh = Image.new("RGBA", (int(px_w * 1.1), int(px_h * 0.12)), (0, 0, 0, 0))
        d = np.zeros((sh.height, sh.width, 4), np.uint8)
        yy, xx = np.ogrid[:sh.height, :sh.width]
        cx, cy = sh.width / 2, sh.height / 2
        ell = ((xx - cx) / (sh.width / 2)) ** 2 + ((yy - cy) / (sh.height / 2)) ** 2 <= 1
        d[..., 3][ell] = 110
        sh = Image.fromarray(d, "RGBA").filter(ImageFilter.GaussianBlur(6))
        img.alpha_composite(sh, (int(bx - sh.width / 2), int(by - sh.height / 2)))
        img.alpha_composite(spr, (int(bx - px_w / 2), int(by - px_h)))
    return img

# ------------------------------------------------------------------------------ demo
if __name__ == "__main__":
    W, H, HFOV = 1600, 900, np.radians(68)
    CAM, TGT = (0.4, 0.4, 1.70), (5.0, 8.0, 1.35)
    room = render_room(W, H, (8.0, 12.0, 3.5), CAM, TGT, HFOV)
    Image.fromarray(room, "RGBA").save("/tmp/room_demo.png")
    print("salle nue -> /tmp/room_demo.png (démo ; sprites branchés via composite())")
