"""Lancer de rayons de la salle, z-buffer, projections, masques de machines (OBB).

ATTENTION REPERE : le plan a Y vers le BAS -> le monde 3D utilise z = -y.
Toutes les fonctions prennent des coordonnees PLAN et font la conversion.
"""
import math, numpy as np
def base(sc, hfov=None):
    hf=hfov or sc.hfov
    W,H=sc.W,sc.H
    CAM=np.array([sc.cam[0], -sc.cam[1], sc.oeil])
    TGT=np.array([sc.cible[0], -sc.cible[1], sc.z_cible])
    f=(W/2)/math.tan(math.radians(hf)/2)
    n=lambda v: v/(np.linalg.norm(v)+1e-12)
    fwd=n(TGT-CAM); rt=n(np.cross(fwd,[0,0,1.0])); up=np.cross(rt,fwd)
    return CAM,fwd,rt,up,f,W,H
def rayons(sc, hfov=None):
    CAM,fwd,rt,up,f,W,H=base(sc,hfov)
    i,j=np.meshgrid(np.arange(W),np.arange(H))
    D=(fwd[None,None,:]+((i-W/2)/f)[...,None]*rt[None,None,:]+(-(j-H/2)/f)[...,None]*up[None,None,:])
    return D/np.linalg.norm(D,axis=2,keepdims=True)
def projeter(sc, x, y, z, hfov=None):
    """point du PLAN (x,y) + hauteur z -> pixel, ou None si derriere la camera"""
    CAM,fwd,rt,up,f,W,H=base(sc,hfov)
    v=np.array([x,-y,z])-CAM; d=float(np.dot(v,fwd))
    if d<=0.05: return None
    return (W/2+f*float(np.dot(v,rt))/d, H/2-f*float(np.dot(v,up))/d)
def profondeur_salle(sc, D, hfov=None):
    """z-buffer des murs/sol/plafond + nuance de gris pour le rendu guide"""
    CAM,*_ ,W,H=base(sc,hfov); O=CAM
    P=[(x,-y) for x,y in sc.poly]; RH=sc.plafond
    best=np.full((H,W),np.inf); teinte=np.zeros((H,W))
    def dedans(px,py):
        r=np.zeros(px.shape,bool)
        for k in range(len(P)):
            ax,ay=P[k]; bx,by=P[(k+1)%len(P)]
            c=((ay>py)!=(by>py))
            with np.errstate(divide='ignore',invalid='ignore'): xi=(bx-ax)*(py-ay)/(by-ay+1e-12)+ax
            r^=c&(px<xi)
        return r
    for zp,t0 in ((0.0,0.66),(RH,0.82)):
        with np.errstate(divide='ignore',invalid='ignore'): t=(zp-O[2])/D[...,2]
        ok=(t>1e-3)&np.isfinite(t)&dedans(O[0]+t*D[...,0],O[1]+t*D[...,1])
        u=ok&(t<best); best=np.where(u,t,best); teinte=np.where(u,t0,teinte)
    for k in range(len(P)):
        ax,ay=P[k]; bx,by=P[(k+1)%len(P)]; ex,ey=bx-ax,by-ay
        den=D[...,0]*ey-D[...,1]*ex
        with np.errstate(divide='ignore',invalid='ignore'):
            t=((ax-O[0])*ey-(ay-O[1])*ex)/den
            s=np.where(abs(ex)>abs(ey),(O[0]+t*D[...,0]-ax)/(ex+1e-12),(O[1]+t*D[...,1]-ay)/(ey+1e-12))
        z=O[2]+t*D[...,2]
        ok=(t>1e-3)&np.isfinite(t)&(s>=0)&(s<=1)&(z>=0)&(z<=RH)
        u=ok&(t<best); best=np.where(u,t,best); teinte=np.where(u,0.74+0.04*((k%3)-1),teinte)
    return best,teinte
def profondeur_machine(sc, D, m, hfov=None, z0=0.0, z1=None):
    """profondeur d'entree dans la boite orientee d'une machine (inf hors boite)"""
    CAM,*_,W,H=base(sc,hfov); O=CAM
    z1=m["H"] if z1 is None else z1
    a=math.radians(-m["rot"]); ca,sa=math.cos(a),math.sin(a)
    ox,oy,oz=O[0]-m["x"], O[1]+m["y"], O[2]
    lox=ox*ca-oy*sa; loy=ox*sa+oy*ca
    dx,dy,dz=D[...,0],D[...,1],D[...,2]
    ldx=dx*ca-dy*sa; ldy=dx*sa+dy*ca
    t0=np.full((H,W),-np.inf); t1=np.full((H,W),np.inf)
    for o,d,lo,hi in ((lox,ldx,-m["L"]/2,m["L"]/2),(loy,ldy,-m["P"]/2,m["P"]/2),(oz,dz,z0,z1)):
        with np.errstate(divide='ignore',invalid='ignore'):
            ta=(lo-o)/d; tb=(hi-o)/d
        t0=np.maximum(t0,np.nan_to_num(np.minimum(ta,tb),nan=-np.inf))
        t1=np.minimum(t1,np.nan_to_num(np.maximum(ta,tb),nan=np.inf))
    hit=(t1>=np.maximum(t0,0))&(t1>0)
    return np.where(hit,np.maximum(t0,0),np.inf)
def masque_visible(sc, m, autres=(), hfov=None):
    """silhouette de m reellement visible : devant les murs ET devant les autres machines"""
    D=rayons(sc,hfov); mur,_=profondeur_salle(sc,D,hfov)
    t=profondeur_machine(sc,D,m,hfov)
    devant=np.full(mur.shape,np.inf)
    for o in autres:
        devant=np.minimum(devant,profondeur_machine(sc,D,o,hfov))
    seul=np.isfinite(t)&(t<mur)
    return seul&(t<devant), seul
