"""Scene du Planner : polygone de la salle, plafond, machines, camera.
Tout vient d'un JSON — aucun parametre code en dur.

Convention de repere : le plan 2D a Y VERS LE BAS. Le monde 3D utilise z = -y.
Ne jamais utiliser les coordonnees du plan telles quelles : l'image sortirait en miroir.
"""
import json, math
class Scene:
    def __init__(self, chemin):
        d=json.load(open(chemin, encoding="utf-8"))
        self.nom=d.get("nom","salle")
        self.poly=[(p[0],p[1]) for p in d["polygone"]]      # metres, y vers le bas
        self.plafond=float(d.get("plafond",4.0))
        self.machines=d["machines"]                          # cf. exemple-salle2.json
        c=d.get("camera")
        self.cam=(c["x"],c["y"]) if c else None
        self.cible=(c["cible_x"],c["cible_y"]) if c else None
        self.hfov=float(c["hfov"]) if c else None
        self.oeil=float(c.get("oeil",1.60)) if c else 1.60
        self.z_cible=float(c.get("z_cible",1.30)) if c else 1.30
        self.W=int(d.get("largeur",1600)); self.H=int(d.get("hauteur",900))
    def coins(self, m):
        """4 coins de l'emprise au sol d'une machine, dans le plan"""
        a=math.radians(m["rot"]); ca,sa=math.cos(a),math.sin(a)
        L,P=m["L"],m["P"]
        return [(m["x"]+dx*ca-dy*sa, m["y"]+dx*sa+dy*ca)
                for dx,dy in [(-L/2,-P/2),(L/2,-P/2),(L/2,P/2),(-L/2,P/2)]]
    def dedans(self, p):
        x,y=p; c=False
        for i in range(len(self.poly)):
            ax,ay=self.poly[i]; bx,by=self.poly[(i+1)%len(self.poly)]
            if (ay>y)!=(by>y):
                xi=(bx-ax)*(y-ay)/(by-ay+1e-12)+ax
                if x<xi: c=not c
        return c
    def dist_mur(self, p):
        d=1e9
        for i in range(len(self.poly)):
            a=self.poly[i]; b=self.poly[(i+1)%len(self.poly)]
            vx,vy=b[0]-a[0],b[1]-a[1]; wx,wy=p[0]-a[0],p[1]-a[1]
            t=max(0,min(1,(wx*vx+wy*vy)/(vx*vx+vy*vy)))
            d=min(d,math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy)))
        return d
    def dist_machine(self, p):
        d=1e9
        for m in self.machines:
            pts=self.coins(m)
            for i in range(4):
                a=pts[i]; b=pts[(i+1)%4]
                vx,vy=b[0]-a[0],b[1]-a[1]; wx,wy=p[0]-a[0],p[1]-a[1]
                t=max(0,min(1,(wx*vx+wy*vy)/(vx*vx+vy*vy+1e-9)))
                d=min(d,math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy)))
        return d
    def mur_traverse(self, o, p):
        dx,dy=p[0]-o[0],p[1]-o[1]
        for i in range(len(self.poly)):
            a=self.poly[i]; b=self.poly[(i+1)%len(self.poly)]
            ex,ey=b[0]-a[0],b[1]-a[1]; den=dx*ey-dy*ex
            if abs(den)<1e-12: continue
            t=((a[0]-o[0])*ey-(a[1]-o[1])*ex)/den
            s=((a[0]-o[0])*dy-(a[1]-o[1])*dx)/den
            if 1e-6<t<1-1e-6 and 1e-6<s<1-1e-6: return True
        return False
    def plaquer_dos(self):
        """plaque le dos (arete locale -P) de chaque machine contre son mur d'appui"""
        for m in self.machines:
            w=m.get("mur")
            if w is None: continue
            a=self.poly[w]; b=self.poly[(w+1)%len(self.poly)]
            ang=math.radians(m["rot"]); ca,sa=math.cos(ang),math.sin(ang)
            dos=(m["x"]+(m["P"]/2)*sa, m["y"]-(m["P"]/2)*ca)
            vx,vy=b[0]-a[0],b[1]-a[1]; wx,wy=dos[0]-a[0],dos[1]-a[1]
            t=max(0,min(1,(wx*vx+wy*vy)/(vx*vx+vy*vy)))
            px,py=a[0]+t*vx, a[1]+t*vy
            d=math.hypot(dos[0]-px,dos[1]-py)
            n=math.hypot(vx,vy); nx,ny=-vy/n,vx/n
            if (m["x"]-dos[0])*nx+(m["y"]-dos[1])*ny<0: nx,ny=-nx,-ny
            m["x"]+=nx*d; m["y"]+=ny*d
