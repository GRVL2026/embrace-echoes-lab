#!/usr/bin/env python3
"""
Visualisation de contrôle du harnais caméra du Planner.

    PLANNER_DUMP=1 npx vitest run --config vitest.harness.config.ts
    python3 scripts/planner_camera_viz.py

Lit artifacts/planner-camera/cases.json (écrit par le test) et produit, pour chaque cas :
  - PANNEAU GAUCHE  : le plan vu du dessus — polygone de la salle, empreintes orientées des
    machines, poteaux, position de la caméra, cône de vision (fov HORIZONTAL) et rayons
    caméra → machine (rouge = coupé par un mur).
  - PANNEAU DROIT   : l'image 1600×900 telle que la caméra la verra — arêtes des boîtes
    projetées avec la VRAIE matrice de projection, cadre de marge NDC 0,92, nom des machines.
  - BANDEAU BAS     : le verdict de chaque invariant.

Aucun WebGL : on redessine ce que le GPU dessinerait, pour que l'œil humain tranche en 2 s.
"""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "artifacts", "planner-camera")
SRC = os.path.join(DIR, "cases.json")

PLAN_W, PLAN_H = 760, 560
SHOT_W, SHOT_H = 760, 428
FOOT = 200            # bandeau des invariants
PAD = 24

BG      = (24, 26, 32)
INK     = (232, 234, 240)
MUTED   = (140, 146, 160)
ROOMC   = (90, 160, 255)
MACH    = (255, 176, 60)
MACH_F  = (255, 176, 60, 60)
CAMC    = (60, 220, 140)
FRUST   = (60, 220, 140, 40)
BAD     = (255, 92, 92)
OKC     = (90, 220, 140)
WARNC   = (240, 200, 90)


def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Menlo.ttc",
              "/System/Library/Fonts/Menlo.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


F10, F12, F14 = font(10), font(12), font(15)


def obb_footprint(m):
    """4 coins au sol, MÊME formule que le TS (rotation.y = theta)."""
    c, s = math.cos(m["theta"]), math.sin(m["theta"])
    out = []
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        lx, lz = sx * m["hw"], sz * m["hd"]
        out.append((m["x"] + lx * c + lz * s, m["z"] - lx * s + lz * c))
    return out


def seg_cross(p1, p2, p3, p4):
    def d(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2, d3, d4 = d(p3, p4, p1), d(p3, p4, p2), d(p1, p2, p3), d(p1, p2, p4)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def draw_plan(case):
    img = Image.new("RGBA", (PLAN_W, PLAN_H), BG)
    dr = ImageDraw.Draw(img, "RGBA")
    poly = [(p["x"], p["z"]) for p in case["poly"]]
    cam = case["camera"]
    cpos = (cam["position"]["x"], cam["position"]["z"])
    tgt = (cam["target"]["x"], cam["target"]["z"])

    pts = list(poly) + [cpos, tgt]
    for m in case["machines"]:
        pts += obb_footprint(m)
    if not pts:
        return img
    x0 = min(p[0] for p in pts) - 1.0; x1 = max(p[0] for p in pts) + 1.0
    z0 = min(p[1] for p in pts) - 1.0; z1 = max(p[1] for p in pts) + 1.0
    sc = min((PLAN_W - 2 * PAD) / max(0.5, x1 - x0), (PLAN_H - 2 * PAD - 18) / max(0.5, z1 - z0))
    ox = PAD + ((PLAN_W - 2 * PAD) - (x1 - x0) * sc) / 2
    oz = PAD + ((PLAN_H - 2 * PAD - 18) - (z1 - z0) * sc) / 2

    def T(p):
        # z croît vers le haut de l'écran (le plan 2D d'origine a y vers le bas)
        return (ox + (p[0] - x0) * sc, PLAN_H - 18 - oz - (p[1] - z0) * sc)

    # échelle
    dr.line([T((x0 + 0.2, z0 + 0.2)), T((x0 + 1.2, z0 + 0.2))], fill=MUTED, width=2)
    dr.text(T((x0 + 0.25, z0 + 0.3)), "1 m", font=F10, fill=MUTED)

    # cône de vision (fov horizontal dérivé du fov vertical et de l'aspect)
    hfov = 2 * math.atan(math.tan(math.radians(cam["fov"]) / 2) * cam["aspect"])
    ang = math.atan2(tgt[1] - cpos[1], tgt[0] - cpos[0])
    reach = max(x1 - x0, z1 - z0) * 1.5
    wedge = [T(cpos)]
    for k in range(-12, 13):
        a = ang + hfov / 2 * (k / 12.0)
        wedge.append(T((cpos[0] + math.cos(a) * reach, cpos[1] + math.sin(a) * reach)))
    dr.polygon(wedge, fill=FRUST)
    for s in (-1, 1):
        a = ang + s * hfov / 2
        dr.line([T(cpos), T((cpos[0] + math.cos(a) * reach, cpos[1] + math.sin(a) * reach))],
                fill=CAMC, width=1)

    # salle
    if len(poly) >= 2:
        dr.line([T(p) for p in poly] + [T(poly[0])], fill=ROOMC, width=3)

    # poteaux
    for q in case.get("pillars", []):
        c = T((q["x"], q["z"])); r = q["r"] * sc
        dr.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], outline=MUTED, width=2)

    # machines + rayons de visibilité
    for m in case["machines"]:
        fp = [T(p) for p in obb_footprint(m)]
        dr.polygon(fp, fill=MACH_F, outline=MACH)
        blocked = any(seg_cross(cpos, (m["x"], m["z"]), poly[i], poly[(i + 1) % len(poly)])
                      for i in range(len(poly))) if len(poly) >= 3 else False
        dr.line([T(cpos), T((m["x"], m["z"]))], fill=BAD if blocked else (90, 100, 120), width=2 if blocked else 1)
        dr.text(T((m["x"], m["z"])), " " + m["name"][:18], font=F10, fill=MACH)

    # caméra
    c = T(cpos)
    dr.ellipse([c[0] - 6, c[1] - 6, c[0] + 6, c[1] + 6], fill=CAMC)
    dr.line([c, T(tgt)], fill=CAMC, width=2)
    inside = point_in_poly(cpos, poly) if len(poly) >= 3 else False
    dr.text((c[0] + 9, c[1] - 6),
            "CAM %s" % ("intra-muros" if inside else "HORS LES MURS"),
            font=F10, fill=CAMC if inside else BAD)
    dr.text((PAD, PLAN_H - 16), "PLAN VU DU DESSUS  (1 carreau = 1 m)", font=F10, fill=MUTED)
    return img


def point_in_poly(p, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        a, b = poly[i], poly[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
        j = i
    return inside


EDGES = [(0, 1), (0, 2), (0, 4), (1, 3), (1, 5), (2, 3), (2, 6), (3, 7), (4, 5), (4, 6), (5, 7), (6, 7)]


def draw_shot(case, W, H):
    img = Image.new("RGBA", (SHOT_W, SHOT_H), (44, 46, 54))
    dr = ImageDraw.Draw(img, "RGBA")
    k = min(SHOT_W / W, SHOT_H / H)
    ox, oz = (SHOT_W - W * k) / 2, (SHOT_H - H * k) / 2
    dr.rectangle([ox, oz, ox + W * k, oz + H * k], fill=(30, 32, 38), outline=MUTED)
    # cadre de marge NDC 0,92
    mx, my = W * 0.04, H * 0.04
    dr.rectangle([ox + mx * k, oz + my * k, ox + (W - mx) * k, oz + (H - my) * k],
                 outline=(80, 86, 100))
    for mp in case["projected"]:
        pts = mp["corners"]
        col = MACH if all(c["depth"] > 0 for c in pts) else BAD
        for a, b in EDGES:
            if pts[a]["depth"] <= 0 or pts[b]["depth"] <= 0:
                continue
            dr.line([(ox + pts[a]["px"] * k, oz + pts[a]["py"] * k),
                     (ox + pts[b]["px"] * k, oz + pts[b]["py"] * k)], fill=col, width=1)
        vis = [c for c in pts if c["depth"] > 0]
        if vis:
            cx = sum(c["px"] for c in vis) / len(vis); cy = sum(c["py"] for c in vis) / len(vis)
            dr.text((ox + cx * k - 10, oz + cy * k), mp["name"][:16], font=F10, fill=col)
    dr.text((6, SHOT_H - 16), "CE QUE LA CAMERA VOIT  (%d×%d, projection exacte)" % (W, H), font=F10, fill=MUTED)
    return img


def render(case, W, H):
    img = Image.new("RGBA", (PLAN_W + SHOT_W + 3 * PAD, PLAN_H + FOOT + 2 * PAD), BG)
    dr = ImageDraw.Draw(img)
    dr.text((PAD, 10), case["label"], font=F14, fill=INK)
    cam = case["camera"]
    dr.text((PAD, 32), "cam (%.2f, %.2f, %.2f) → (%.2f, %.2f, %.2f)  fov %.0f°  %s  couverture %.1f %%"
            % (cam["position"]["x"], cam["position"]["y"], cam["position"]["z"],
               cam["target"]["x"], cam["target"]["y"], cam["target"]["z"], cam["fov"],
               cam["reason"], case["coverage"] * 100), font=F12, fill=MUTED)
    img.paste(draw_plan(case), (PAD, 56))
    img.paste(draw_shot(case, W, H), (PLAN_W + 2 * PAD, 56))
    y = 56 + PLAN_H + 12
    for c in case["checks"]:
        col = OKC if c["ok"] else (BAD if c["blocking"] else WARNC)
        tag = "OK  " if c["ok"] else ("FAIL" if c["blocking"] else "warn")
        dr.text((PAD, y), "%s  %-24s %s" % (tag, c["id"], c["value"]), font=F12, fill=col)
        y += 15
        if y > PLAN_H + FOOT + 40:
            break
    return img


def main():
    if not os.path.exists(SRC):
        sys.exit("cases.json absent — lance d'abord :\n"
                 "  PLANNER_DUMP=1 npx vitest run --config vitest.harness.config.ts")
    data = json.load(open(SRC))
    W, H = data["W"], data["H"]
    sheets = []
    for case in data["cases"]:
        img = render(case, W, H)
        out = os.path.join(DIR, case["key"] + ".png")
        img.convert("RGB").save(out)
        print("écrit", out)
        sheets.append(img)
    # planche contact
    if sheets:
        w = max(s.width for s in sheets)
        sheet = Image.new("RGB", (w, sum(s.height for s in sheets)), BG)
        y = 0
        for s in sheets:
            sheet.paste(s.convert("RGB"), (0, y)); y += s.height
        sheet.save(os.path.join(DIR, "_planche.png"))
        print("écrit", os.path.join(DIR, "_planche.png"))


if __name__ == "__main__":
    main()
