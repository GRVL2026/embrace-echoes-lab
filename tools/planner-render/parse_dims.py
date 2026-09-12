#!/usr/bin/env python3
"""Parseur du métachamp Shopify `custom.specs_dimensions` -> {width, depth, height} en CM.

Reconstruit depuis la passation (PASSATIONrenduphotorealiste.md §4.1), les 3 scripts
d'origine étant introuvables sur le Mac. Principe validé : chercher CHAQUE axe par sa
lettre (L=largeur, P=profondeur, H=hauteur) indépendamment — l'ordre n'a plus d'importance
et l'inversion L/P se corrige toute seule. Repli sur le format nu NxNxN (accessoires, en cm).
Garde-fou : rejeter tout ce qui sort de la plage 20 cm – 10 m.

Convention d'unités : le format nominal Shopify est en MILLIMÈTRES (ex. "L 705 ... mm")
-> converti en cm (/10). Le repli NxNxN sans unité (ex. "72x26x28") est déjà en CM.
Sortie : dict {width, depth, height} en cm (float), axes absents = None. None si < 2 axes.
"""
import re

NOMBRE = r"\d+(?:[.,]\d+)?"
MIN_CM, MAX_CM = 20.0, 1000.0


def _clean(x):
    """Garde une cote seulement si elle est dans la plage plausible (cm)."""
    return x if (x is not None and MIN_CM <= x <= MAX_CM) else None


def parse_dims(s):
    if not s or not isinstance(s, str):
        return None
    txt = s.replace("×", "x").replace("✕", "x")  # normalise le signe multiplié
    axes = {"width": None, "depth": None, "height": None}

    # 1) Recherche par lettre (valeurs en mm -> cm). Intervalle "800/850" -> on prend le max.
    found = 0
    for lettre, cle in (("L", "width"), ("P", "depth"), ("H", "height")):
        m = re.search(rf"\b{lettre}\s*({NOMBRE})(?:\s*/\s*({NOMBRE}))?", txt, re.IGNORECASE)
        if m:
            val_mm = max(float(v.replace(",", ".")) for v in re.findall(NOMBRE, m.group(0)))
            axes[cle] = _clean(val_mm / 10.0)  # mm -> cm
            found += 1

    # 2) Repli NxNxN (accessoires en cm, sans lettre ni unité) si les lettres n'ont rien donné.
    if sum(1 for v in axes.values() if v is not None) < 2:
        m = re.search(rf"\b({NOMBRE})\s*x\s*({NOMBRE})\s*x\s*({NOMBRE})\b", txt, re.IGNORECASE)
        if m:
            w, d, h = (float(g.replace(",", ".")) for g in m.groups())
            axes = {"width": _clean(w), "depth": _clean(d), "height": _clean(h)}

    # Il faut au moins 2 axes valides, sinon on rejette (valeur bidon / texte).
    if sum(1 for v in axes.values() if v is not None) < 2:
        return None
    return axes


if __name__ == "__main__":
    CAS = [
        "L 705 x P 1450 x H 1980 mm",          # nominal
        "  L 1140 x P 2420 x H 2460 mm",       # espace de tête
        "L 2520 × P 2490 × H 2750 mm",         # signe ×
        "L1190 x P 1930 x H 1910 mm",          # pas d'espace après L
        "L 1250 x P1600 x H 2290 mm",          # pas d'espace après P
        "L 2470x P 1700 x H 2650 mm",          # pas d'espace avant x
        "L 1630 x P 1070 x 670 mm",            # H manquant
        "P 1070 x L 2540 x H 2280 mm",         # L/P inversés
        "L 2110 x P 1190 x H 800/850 mm",      # intervalle
        "Environ L 784 x … en fonction du modèle",  # texte autour
        "L 1377 x P 2134 x H 2143 mm ",        # espace de fin
        "72x26x28",                            # accessoires : cm
        "Test de taille",                      # bidon
        "",                                    # vide
    ]
    for c in CAS:
        print(f"{c!r:48} -> {parse_dims(c)}")
