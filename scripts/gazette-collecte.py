#!/usr/bin/env python3
"""Collecteur de la Gazette — relève la presse locale et l'envoie à Arcade OS.

POURQUOI CE SCRIPT EXISTE, ET PAS UNE EDGE FUNCTION
Google Actualités refuse les adresses IP des centres de données : Supabase comme
Cloudflare reçoivent un 503 « Sorry… ». Depuis une connexion ordinaire, il répond
parfaitement. La collecte se fait donc ici, et l'edge function garde son rôle :
trier, interpréter et stocker. La source reste interchangeable — un service de
collecte hébergé prendrait le relais sans rien changer en aval.

LE SECRET N'EST JAMAIS ÉCRIT ICI. Il est lu dans ~/.config/arcadeos/cron_secret
(chmod 600), fichier que ce script ne fait que lire et n'affiche jamais.

Usage :
    python3 gazette-collecte.py            # 2 derniers jours
    python3 gazette-collecte.py --jours 30 # rattrapage
    python3 gazette-collecte.py --test     # affiche sans envoyer
"""

import argparse, datetime, html, json, os, re, ssl, sys, time
import urllib.parse, urllib.request

FONCTION = "https://yhfghipueqfkgysaulvl.supabase.co/functions/v1/gazette-locale"
SECRET = os.path.expanduser("~/.config/arcadeos/cron_secret")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"

# Types de lieux susceptibles d'acheter des jeux d'arcade, flippers, billards ou grues.
# « plaine de jeux » est volontairement absent : en français de France l'expression
# désigne un terrain de sport, et ne ramène que des comptes rendus de football.
LIEUX = [
    "bowling", '"parc de loisirs"', '"laser game"', '"complexe de loisirs"',
    '"trampoline park"', '"salle de jeux"', '"escape game"', '"bar à jeux"',
    '"salle d\'arcade"', "camping", '"village vacances"', '"parc aquatique"',
    '"parc de jeux indoor"', '"parc de jeux" enfants',
]

EVENEMENTS = (
    '(ouverture OR ouvre OR repris OR reprise OR "change de mains" OR rachète OR racheté OR '
    '"nouveau gérant" OR "nouveaux propriétaires" OR "nouveau propriétaire" OR rénove OR '
    'rénovation OR agrandit OR agrandissement OR investit OR "va ouvrir" OR "ouvrira")'
)

CTX = ssl.create_default_context()


def collecter(jours: int) -> list[dict]:
    depuis = (datetime.date.today() - datetime.timedelta(days=jours)).isoformat()
    vus, articles = set(), []
    for lieu in LIEUX:
        q = f"{lieu} {EVENEMENTS} after:{depuis}"
        url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q)
               + "&hl=fr&gl=FR&ceid=FR:fr")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            xml = urllib.request.urlopen(req, timeout=25, context=CTX).read().decode("utf-8", "ignore")
        except Exception as e:
            print(f"  ⚠️  {lieu} : {type(e).__name__}", file=sys.stderr)
            continue
        for bloc in xml.split("<item>")[1:]:
            t = re.search(r"<title>(.*?)</title>", bloc, re.S)
            l = re.search(r"<link>(.*?)</link>", bloc, re.S)
            d = re.search(r"<pubDate>(.*?)</pubDate>", bloc, re.S)
            s = re.search(r"<source[^>]*>(.*?)</source>", bloc, re.S)
            if not (t and l and d):
                continue
            titre = html.unescape(t.group(1)).strip()
            if titre in vus:
                continue
            try:
                pub = datetime.datetime.strptime(d.group(1)[:16], "%a, %d %b %Y").date()
            except ValueError:
                continue          # sans date exploitable, pas de signal
            vus.add(titre)
            articles.append({
                "titre": titre,
                "url": l.group(1).strip(),
                "source": html.unescape(s.group(1)).strip() if s else "(source inconnue)",
                "publie": pub.isoformat(),
            })
        time.sleep(0.4)           # rester courtois avec le service
    articles.sort(key=lambda a: a["publie"], reverse=True)
    return articles


def envoyer(articles: list[dict]) -> dict:
    if not os.path.exists(SECRET):
        sys.exit(f"Secret introuvable : {SECRET}\n"
                 f"Créez-le avec la valeur de CRON_SECRET, puis : chmod 600 {SECRET}")
    with open(SECRET) as f:
        secret = f.read().strip()
    corps = json.dumps({"articles": articles}).encode()
    req = urllib.request.Request(FONCTION, data=corps, headers={
        "Content-Type": "application/json",
        "x-cron-secret": secret,
    })
    with urllib.request.urlopen(req, timeout=180, context=CTX) as r:
        return json.loads(r.read().decode())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jours", type=int, default=2,
                    help="fenêtre en jours (2 par défaut : le recouvrement absorbe le retard d'indexation)")
    ap.add_argument("--test", action="store_true", help="afficher sans envoyer")
    a = ap.parse_args()

    print(f"Relevé sur {a.jours} jour(s)…")
    articles = collecter(a.jours)
    print(f"{len(articles)} articles collectés")
    if not articles:
        return

    if a.test:
        for x in articles[:25]:
            print(f"  {x['publie']} | {x['source'][:22]:<22} | {x['titre'][:72]}")
        return

    # L'edge function plafonne son tri par lot : on relance tant qu'il reste à traiter.
    for passe in range(1, 11):
        rep = envoyer(articles)
        print(f"  passe {passe} : {rep.get('retenus', 0)} retenus, "
              f"{rep.get('ecartes', 0)} écartés, {rep.get('restants_a_traiter', 0)} restants")
        if not rep.get("restants_a_traiter"):
            break
        time.sleep(2)
    print("Terminé.")


if __name__ == "__main__":
    main()
