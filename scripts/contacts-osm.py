#!/usr/bin/env python3
"""Relais OpenStreetMap depuis une ligne ordinaire.

Overpass étrangle l'adresse IP de Supabase, partagée avec d'autres locataires de
l'hébergeur : la même requête qui aboutit en trente secondes depuis une connexion
domestique n'obtient jamais de créneau depuis une edge function. C'est le problème
qu'avait déjà rencontré la Gazette avec Google, et la parade est la même — faire
passer la requête par la machine de la maison.

Ce script ne décide de rien et ne connaît aucune clé de service. Il demande au serveur
un lot de fiches ET la requête toute faite, la poste à Overpass, et renvoie la réponse
brute. L'appariement et l'écriture restent côté serveur, là où ils sont testés.

    python3 scripts/contacts-osm.py            # déroule tout, par lots de 25
    python3 scripts/contacts-osm.py --essai    # un seul lot, sans rien écrire
"""

from __future__ import annotations   # le Python du système est un 3.9

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FONCTION = 'https://yhfghipueqfkgysaulvl.supabase.co/functions/v1/enrichir-contacts-osm'
SECRET = Path.home() / '.config' / 'arcadeos' / 'cron_secret'

# L'instance principale est la plus fiable depuis une ligne domestique ; les deux autres
# servent de repli quand elle ne distribue plus de créneau.
# kumi.systems en tête : mesuré le 10 août, c'est le seul à répondre quand l'instance
# principale renvoie 504 en huit secondes. L'ordre compte — chaque miroir essayé pour
# rien coûte une minute et demie sur une fenêtre de disponibilité déjà étroite.
MIROIRS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
]
UA = 'Arcade OS - Avranches Automatic (leopaul@avranchesautomatic.com)'

PAUSE_ENTRE_LOTS = 8      # rester courtois : le service est bénévole et mutualisé
ESSAIS_PAR_LOT = 6
PAUSE_LONGUE = 180        # après un lot en échec : laisser passer la vague de charge
REPITS_MAX = 5            # au-delà, le service est fermé, pas encombré


class Injoignable(Exception):
    """Overpass ne répond pas. C'est temporaire : on s'arrête proprement, et surtout
    on ne fait RIEN écrire au serveur — sans quoi le lot serait marqué comme traité
    alors qu'il n'a rien reçu, et ces fiches ne seraient jamais réinterrogées."""


def serveur(charge: dict) -> dict:
    secret = SECRET.read_text().strip()
    req = urllib.request.Request(
        FONCTION,
        data=json.dumps(charge).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-cron-secret': secret},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def overpass(requete: str) -> list:
    dernier = ''
    for essai in range(ESSAIS_PAR_LOT):
        url = MIROIRS[essai % len(MIROIRS)]
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({'data': requete}).encode(),
                headers={'User-Agent': UA},
            )
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read()).get('elements', [])
        except Exception as e:                       # noqa: BLE001 — 504, coupure, JSON tronqué
            dernier = f'{type(e).__name__}: {str(e)[:80]}'
            # Un 504 signifie « aucun créneau libre » et se résorbe en quelques
            # secondes. Réessayer aussitôt ne fait que gâcher une tentative.
            time.sleep(6 + 4 * essai)
    raise Injoignable(dernier)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--essai', action='store_true',
                    help="un seul lot, analysé sans rien écrire en base")
    ap.add_argument('--lot', type=int, default=25)
    ap.add_argument('--source', default='cabine-photo',
                    help="source à enrichir, ou « * » pour toutes")
    ap.add_argument('--hors-segments', default='',
                    help="segments à écarter, séparés par des virgules. Les campings sont "
                         "déjà enrichis : les repasser gaspillerait des créneaux Overpass rares.")
    args = ap.parse_args()

    cible = {'source': args.source}
    if args.hors_segments:
        cible['hors_segments'] = [s.strip() for s in args.hors_segments.split(',') if s.strip()]

    total = {'apparies': 0, 'telephones': 0, 'sites': 0, 'emails': 0}
    tour = 0
    repit = 0   # échecs consécutifs ; remis à zéro dès qu'un lot passe
    while True:
        tour += 1
        depart = serveur({'action': 'points', 'lot': args.lot, **cible})
        fiches = depart.get('fiches') or []
        if not fiches:
            print('Plus aucune fiche à interroger.')
            break
        print(f"Lot {tour} : {len(fiches)} fiches, {depart.get('restants', '?')} restantes… ",
              end='', flush=True)

        try:
            elements = overpass(depart['requete'])
            repit = 0
        except Injoignable as e:
            # Overpass est intermittent : le 10 août, le lot 1 est passé et le lot 2 a
            # échoué dans la minute. Abandonner là obligeait à relancer douze fois à la
            # main. On patiente donc franchement — le lot n'ayant rien écrit, il revient
            # tel quel au tour suivant — et on ne renonce qu'après plusieurs longues
            # attentes, signe que le service est vraiment fermé.
            repit += 1
            if repit > REPITS_MAX:
                print(f"\nOverpass reste injoignable après {REPITS_MAX} longues attentes "
                      f"({e}). Rien n'a été perdu : relance quand tu veux, il reprendra ici.")
                return 1
            print(f"indisponible, pause de {PAUSE_LONGUE // 60} min "
                  f"(tentative {repit}/{REPITS_MAX})…", flush=True)
            time.sleep(PAUSE_LONGUE)
            tour -= 1          # ce tour n'a rien traité, il ne compte pas
            continue

        res = serveur({
            'action': 'elements',
            'fiches': fiches,
            'elements': elements,
            'dry_run': args.essai,
            **cible,
        })
        if res.get('error'):
            print(f"\nErreur serveur : {res['error']}")
            return 1

        print(f"{len(elements)} objets → {res['apparies']} appariés "
              f"({res['telephones']} tél, {res['sites']} sites, {res['emails']} e-mails)")
        for cle in total:
            total[cle] += res.get(cle, 0)

        if args.essai:
            print('\nAperçu :')
            for ligne in res.get('apercu', []):
                print('  ' + ligne)
            print("\nEssai terminé, rien n'a été écrit.")
            return 0

        if not res.get('restants'):
            break
        time.sleep(PAUSE_ENTRE_LOTS)

    print(f"\nTerminé : {total['apparies']} fiches appariées, "
          f"{total['telephones']} téléphones, {total['sites']} sites, {total['emails']} e-mails.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
