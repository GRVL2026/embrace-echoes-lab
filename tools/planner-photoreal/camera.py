"""Solveur de point de vue, en DEUX TEMPS.

1. recherche large et rapide : cadrage + face avant tournee vers le spectateur + lisibilite ;
2. re-classement des meilleures poses avec un VRAI z-buffer basse resolution (murs + machines),
   qui mesure la fraction de silhouette REELLEMENT visible.

Pourquoi deux temps : approximer le masquage entre machines par boites englobantes est faux
(la boite d'une table basse recouvre celle d'une borne haute alors qu'elle n'en cache que le pied).
"""
import math, copy, numpy as np
import geometrie as G
SEUIL_VISIBLE=0.10        # sous 10 % visible, la machine ne doit PAS etre dessinee
DIST_MIN_MACHINE=1.6      # m : ne pas planter l'objectif dans une machine
DIST_MIN_MUR=0.6
def _note_rapide(sc, cam, cible, hfov):
    s2=copy.copy(sc); s2.cam=cam; s2.cible=cible; s2.hfov=hfov
    W,H=sc.W,sc.H; total=0
    for m in sc.machines:
        if sc.mur_traverse(cam,(m["x"],m["y"])): continue
        pts=[]
        ok=True
        for (px,py) in sc.coins(m):
            for z in (0,m["H"]):
                q=G.projeter(s2,px,py,z,hfov)
                if q is None: ok=False; break
                pts.append(q)
            if not ok: break
        if not ok: continue
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        bw=max(xs)-min(xs); bh=max(ys)-min(ys)
        ix=max(0,min(max(xs),W)-max(min(xs),0)); iy=max(0,min(max(ys),H)-max(min(ys),0))
        cadre=(ix*iy)/max(1e-6,bw*bh)
        a=math.radians(m["rot"]); nx,ny=-math.sin(a),math.cos(a)
        vx,vy=cam[0]-m["x"],cam[1]-m["y"]; vn=math.hypot(vx,vy)+1e-9
        face=(nx*vx+ny*vy)/vn
        lis=min(1,bw/90)*min(1,bh/110)
        total+=cadre*(0.35+0.65*max(0,face))*lis
    return total
def _note_zbuffer(sc, cam, cible, hfov, w=200, h=112):
    s2=copy.copy(sc); s2.cam=cam; s2.cible=cible; s2.hfov=hfov; s2.W=w; s2.H=h
    D=G.rayons(s2,hfov); mur,_=G.profondeur_salle(s2,D,hfov)
    T=[G.profondeur_machine(s2,D,m,hfov) for m in sc.machines]
    res=[]
    for i,ti in enumerate(T):
        seul=np.isfinite(ti)&(ti<mur)
        autres=np.full((h,w),np.inf)
        for j,tj in enumerate(T):
            if j!=i: autres=np.minimum(autres,tj)
        reel=seul&(ti<autres)
        res.append((int(seul.sum()), int(reel.sum())))
    return res
def choisir(sc, cibles=None, fovs=(95,105,115), pas=0.5, top=40):
    """renvoie (cam, cible, hfov, details) — details = [(nom, silhouette_px, visible_%)]"""
    cibles=cibles or [(x,y) for x in (0.4,0.55,0.7) for y in (0.3,0.5,0.7)]
    xs=[p[0] for p in sc.poly]; ys=[p[1] for p in sc.poly]
    cibles=[(min(xs)+(max(xs)-min(xs))*a, min(ys)+(max(ys)-min(ys))*b) for a,b in cibles]
    cands=[]
    x=min(xs)
    while x<=max(xs):
        y=min(ys)
        while y<=max(ys):
            p=(x,y)
            if sc.dedans(p) and sc.dist_mur(p)>=DIST_MIN_MUR and sc.dist_machine(p)>=DIST_MIN_MACHINE:
                for t in cibles:
                    if sc.dedans(t) and math.dist(p,t)>=2.5:
                        for hf in fovs:
                            cands.append((_note_rapide(sc,p,t,hf),p,t,hf))
            y+=pas
        x+=pas
    if not cands: raise RuntimeError("aucune pose valable dans ce polygone")
    cands.sort(key=lambda c:-c[0]); cands=cands[:top]
    best=None
    for _,p,t,hf in cands:
        r=_note_zbuffer(sc,p,t,hf)
        n=sum(1 for s,v in r if s>=60 and v/max(s,1)>0.5)
        sc_=sum((v/max(s,1))*min(1,s/400) for s,v in r)
        if not best or (n,sc_)>(best[0],best[1]): best=(n,sc_,p,t,hf,r)
    n,_,p,t,hf,r=best
    det=[(m["nom"],s,(v/max(s,1))) for m,(s,v) in zip(sc.machines,r)]
    return p,t,hf,det
def a_dessiner(det):
    """machines a rendre : celles visibles au-dela du seuil"""
    return [i for i,(_,s,v) in enumerate(det) if s>0 and v>=SEUIL_VISIBLE]
