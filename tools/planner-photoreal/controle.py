"""Controle d'une passe : ecart au plan + reperes de murs, en surimpression.
La mesure NE REMPLACE PAS la lecture visuelle de l'image (regle d'or n.3).
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import geometrie as G
COULS=[(255,70,70),(70,220,120),(90,170,255),(255,220,60),(230,110,230),(120,255,230)]
def _police(n=20):
    try: return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf",n)
    except Exception: return ImageFont.load_default()
def surimpression(sc, image, sortie, machines=None, murs=True):
    im=Image.open(image).convert("RGB").resize((sc.W,sc.H)); dr=ImageDraw.Draw(im); f=_police()
    rapport=[]
    for k,m in enumerate(machines if machines is not None else sc.machines):
        col=COULS[k%len(COULS)]
        bas=[G.projeter(sc,p[0],p[1],0) for p in sc.coins(m)]
        haut=[G.projeter(sc,p[0],p[1],m["H"]) for p in sc.coins(m)]
        if any(v is None for v in bas+haut): continue
        for a,b in zip(bas,haut): dr.line([a,b],fill=col,width=3)
        dr.line(bas+[bas[0]],fill=col,width=3); dr.line(haut+[haut[0]],fill=col,width=3)
        xs=[p[0] for p in bas+haut]; ys=[p[1] for p in bas+haut]
        dr.text((min(xs),min(ys)-22),m["nom"],font=f,fill=col)
        rapport.append((m["nom"],int(min(xs)),int(max(xs)),int(min(ys)),int(max(ys))))
    if murs:
        for i,(x,y) in enumerate(sc.poly):
            a=G.projeter(sc,x,y,0); b=G.projeter(sc,x,y,sc.plafond)
            if a and b and -300<a[0]<sc.W+300:
                dr.line([a,b],fill=(255,255,255),width=3)
                dr.text((a[0]+5,a[1]-24),"ABCDEFGH"[i%8],font=f,fill=(255,255,255))
    im.save(sortie,quality=93)
    return rapport
