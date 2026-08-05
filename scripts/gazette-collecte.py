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

# Le Mac tourne sous Python 3.9 : sans cet import, « str | None » lève une TypeError au
# chargement du fichier, avant même la première ligne de code exécutée.
from __future__ import annotations

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


# ── Résolution des liens et lecture des articles ─────────────────────────────────
# Google Actualités ne livre qu'un lien chiffré que le navigateur refuse d'ouvrir
# (« news.google.com est bloqué ») : sa page de redirection est en JavaScript, et aucune
# variante d'URL ne la contourne. En revanche le titre exact, cherché sur le web, ramène
# l'article en un coup. Cette recherche se fait ici, depuis la même connexion ordinaire
# qui nous donne déjà accès à la presse.

def resoudre(titre: str, source: str | None) -> str | None:
    """Retrouve l'adresse réelle d'un article à partir de son titre exact."""
    for requete in (f'"{titre}"', titre):
        url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(requete)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            page = urllib.request.urlopen(req, timeout=20, context=CTX).read().decode("utf-8", "ignore")
        except Exception:
            return None
        liens = []
        for m in re.findall(r'class="result__a"[^>]*href="([^"]+)"', page):
            if "uddg=" in m:
                extrait = re.search(r"uddg=([^&]+)", m)
                if not extrait:
                    continue
                m = urllib.parse.unquote(extrait.group(1))
            m = html.unescape(m)
            if "duckduckgo.com" not in m:
                liens.append(m)
        if not liens:
            time.sleep(2)
            continue
        # Le journal indiqué par Google départage : sur un sujet repris par plusieurs
        # titres, on veut l'article qu'on a effectivement lu et daté.
        if source:
            racine = re.sub(r"^www\.|\.(fr|com|be)$", "", source.lower()).split(".")[0]
            for l in liens:
                if racine and racine in l.lower():
                    return l
        return liens[0]
    return None


def lire(url: str) -> str:
    """Texte lisible d'un article. Un paywall laisse passer les premiers paragraphes,
    et c'est justement là que le journaliste cite le gérant."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"})
        brut = urllib.request.urlopen(req, timeout=20, context=CTX).read(900_000).decode("utf-8", "ignore")
    except Exception:
        return ""
    brut = re.sub(r"(?is)<(script|style|nav|footer|aside)[^>]*>.*?</\1>", " ", brut)
    paras = re.findall(r"(?is)<(?:p|h1|h2|blockquote)[^>]*>(.*?)</(?:p|h1|h2|blockquote)>", brut)
    texte = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", x)) for x in paras)
    return re.sub(r"\s+", " ", texte).strip()[:9000]


def enrichir() -> None:
    """Résout les liens et fait lire les articles pour en tirer le dirigeant."""
    total = 0
    for tour in range(1, 21):
        rep = appeler({"action": "a_enrichir", "limite": 12})
        lot = rep.get("a_enrichir") or []
        if not lot:
            print(f"  enrichissement terminé ({total} articles traités)")
            return
        charges = []
        for sig in lot:
            titre, source = sig.get("titre", ""), sig.get("source")
            vraie = resoudre(titre, source) if "news.google.com" in (sig.get("url") or "") else sig.get("url")
            texte = lire(vraie) if vraie else ""
            charges.append({"id": sig["id"], "url": vraie, "texte": texte})
            time.sleep(1.5)          # rester courtois avec le moteur de recherche
        r = appeler({"enrichis": charges})
        total += r.get("traites", 0)
        print(f"  lecture {tour} : {r.get('traites', 0)} traités, "
              f"{r.get('lus', 0)} lisibles, {r.get('avec_contact', 0)} dirigeants trouvés "
              f"(reste {rep.get('restants', '?')})")


def appeler(charge: dict) -> dict:
    if not os.path.exists(SECRET):
        sys.exit(f"Secret introuvable : {SECRET}\n"
                 f"Créez-le avec la valeur de CRON_SECRET, puis : chmod 600 {SECRET}")
    with open(SECRET) as f:
        secret = f.read().strip()
    corps = json.dumps(charge).encode()
    req = urllib.request.Request(FONCTION, data=corps, headers={
        "Content-Type": "application/json",
        "x-cron-secret": secret,
    })
    try:
        with urllib.request.urlopen(req, timeout=180, context=CTX) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # Ne jamais masquer le motif : une erreur sans son corps de réponse coûte un
        # aller-retour de diagnostic à chaque fois.
        detail = e.read().decode("utf-8", "ignore")[:600]
        sys.exit(f"La fonction a répondu {e.code} :\n{detail}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jours", type=int, default=2,
                    help="fenêtre en jours (2 par défaut : le recouvrement absorbe le retard d'indexation)")
    ap.add_argument("--test", action="store_true", help="afficher sans envoyer")
    ap.add_argument("--enrichir-seulement", action="store_true",
                    help="ne rien collecter : résoudre les liens et lire les articles déjà en base")
    a = ap.parse_args()

    if a.enrichir_seulement:
        print("Résolution des liens et lecture des articles…")
        enrichir()
        return

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
        rep = appeler({"articles": articles})
        print(f"  passe {passe} : {rep.get('retenus', 0)} retenus, "
              f"{rep.get('ecartes', 0)} écartés, {rep.get('restants_a_traiter', 0)} restants")
        if not rep.get("restants_a_traiter"):
            break
        time.sleep(2)

    print("Résolution des liens et lecture des articles…")
    enrichir()
    print("Terminé.")


if __name__ == "__main__":
    main()
