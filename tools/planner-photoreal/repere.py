"""Fabrication du REPERE de placement et composition finale.

Le repere porte TOUTE la geometrie : volume oriente projete, decoupe par z-buffer
(murs + machines devant), plus les elements hors cotes (mat, topper) en second volume.
Le texte de la consigne ne sert qu'a ce que le repere ne peut pas dire.

Regle d'echelle : sous ~260 px le repere est IGNORE par le modele. On bascule alors en
gros plan (fenetre recadree, generee a pleine taille, recollee ensuite).
"""
import math, numpy as np
from PIL import Image, ImageFilter, ImageDraw
import geometrie as G
CIBLE_PX=380.0; MINI_PX=260.0
ROUGE=(230,25,25); BLEU=(0,150,255)
def fabriquer(sc, fond, m, autres=(), sortie="repere.jpg", extra=None, hfov=None):
    """Peint le volume de m sur l'image `fond`. Renvoie (fenetre, taille_repere_px)."""
    vis,_=G.masque_visible(sc,m,autres,hfov)
    if vis.sum()==0: return None,0
    ys,xs=np.nonzero(vis)
    bw=int(xs.max()-xs.min()); bh=int(ys.max()-ys.min())
    img=np.array(Image.open(fond).convert("RGB").resize((sc.W,sc.H))).astype(np.float32)
    img=img*(1-vis[...,None]*0.58)+np.array(ROUGE,np.float32)*vis[...,None]*0.58
    if extra:   # element hors cotes : mat, topper — second volume, autre couleur
        e,_=G.masque_visible(sc,{**m,**extra},autres,hfov)
        img=img*(1-e[...,None]*0.62)+np.array(BLEU,np.float32)*e[...,None]*0.62
    plein=Image.fromarray(np.clip(img,0,255).astype(np.uint8))
    taille=max(bw,bh)
    if taille>=MINI_PX:
        plein.save(sortie,quality=95); return (0,0,sc.W,sc.H),taille
    z=min(4.0,CIBLE_PX/max(taille,1))
    w=int(sc.W/z); h=int(sc.H/z)
    cx=(xs.min()+xs.max())/2; cy=(ys.min()+ys.max())/2
    x0=int(max(0,min(sc.W-w,cx-w/2))); y0=int(max(0,min(sc.H-h,cy-h/2)))
    plein.crop((x0,y0,x0+w,y0+h)).resize((sc.W,sc.H),Image.LANCZOS).save(sortie,quality=95)
    return (x0,y0,w,h),int(taille*z)
def recoller(sc, fond, rendu, fenetre, sortie, adoucir=40):
    """remet un rendu en gros plan dans le plein cadre"""
    x0,y0,w,h=fenetre
    base=Image.open(fond).convert("RGB").resize((sc.W,sc.H))
    if (w,h)==(sc.W,sc.H):
        Image.open(rendu).convert("RGB").resize((sc.W,sc.H),Image.LANCZOS).save(sortie,quality=95); return
    z=Image.open(rendu).convert("RGB").resize((w,h),Image.LANCZOS)
    msk=Image.new("L",(w,h),0)
    ImageDraw.Draw(msk).rectangle([adoucir,adoucir,w-adoucir,h-adoucir],fill=255)
    base.paste(z,(x0,y0),msk.filter(ImageFilter.GaussianBlur(adoucir/2)))
    base.save(sortie,quality=95)
def corps(sc, passe, vide, m, seuil=40, marge=60):
    """corps opaque de la machine = ce qui a change par rapport a la salle vide,
       borne a l'emprise du plan dilatee (pour ignorer les changements d'eclairage lointains)"""
    a=np.array(Image.open(vide).convert("RGB").resize((sc.W,sc.H))).astype(np.int16)
    b=np.array(Image.open(passe).convert("RGB").resize((sc.W,sc.H))).astype(np.int16)
    mk=(np.abs(b-a).max(axis=2)>seuil)
    th,_=G.masque_visible(sc,m)
    bb=Image.fromarray((th*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2*marge+1))
    mk &= np.array(bb)>0
    im=Image.fromarray((mk*255).astype(np.uint8))
    im=im.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(11)).filter(ImageFilter.MaxFilter(7))
    return np.array(im)>0
def composer(sc, vide, passes, sortie):
    """COMPOSITION PAR ECART A LA SALLE VIDE.
       finale = salle vide + somme des ecarts (ombres negatives, halos positifs),
       puis corps opaques poses du plus LOINTAIN au plus PROCHE.
       Chaque passe a ete generee INDEPENDAMMENT sur la meme salle vide : pas de derive possible.
    """
    v=np.array(Image.open(vide).convert("RGB").resize((sc.W,sc.H))).astype(np.float32)
    base=v.copy()
    for m,f in passes:
        p=np.array(Image.open(f).convert("RGB").resize((sc.W,sc.H))).astype(np.float32)
        c=corps(sc,f,vide,m)
        base+=(p-v)*(~c)[...,None]
    ordre=sorted(passes,key=lambda t:-math.dist(sc.cam,(t[0]["x"],t[0]["y"])))
    for m,f in ordre:
        p=np.array(Image.open(f).convert("RGB").resize((sc.W,sc.H))).astype(np.float32)
        c=corps(sc,f,vide,m)
        al=(np.array(Image.fromarray((c*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32)/255.)[...,None]
        base=base*(1-al)+p*al
    Image.fromarray(np.clip(base,0,255).astype(np.uint8)).save(sortie,quality=95)
