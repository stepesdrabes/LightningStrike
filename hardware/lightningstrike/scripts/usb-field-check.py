"""Quasi-static 2-D odd-mode microstrip estimate, not a fabrication coupon test.

Finite-volume Laplace solve, conductor potential 1 V, odd-symmetry plane and
reference plane 0 V, remote Neumann boundaries. Solve dielectric and vacuum
capacitance, then Zdiff = 2/(c*sqrt(Codd*Codd_vacuum)). Length units cancel.
Requires numpy/scipy; install locally in .tools/physics (never in project source).
"""
import sys, json, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'.tools'/'physics'))
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

def capacitance(width, step, vacuum=False, extent=1.2, er=4.1):
    gap, h, t = .17, .0994, .035
    # Cell-centred finite volumes; first column sits next to the odd symmetry plane.
    x=np.arange(step/2,extent,step); y=np.arange(step/2,extent,step)
    X,Y=np.meshgrid(x,y)
    metal=(X>=gap/2)&(X<=gap/2+width)&(Y>=h)&(Y<=h+t)
    eps=np.ones_like(X)
    if not vacuum:
        eps[Y<h]=er
        # 30.48um mask between traces; 15.24um above the copper.
        eps[(Y>=h)&(Y<h+.03048)]=3.8
        eps[(X>=gap/2)&(X<=gap/2+width)&(Y>=h)&(Y<h+t+.01524)]=3.8
    ny,nx=X.shape; ids=np.arange(nx*ny).reshape(ny,nx)
    rows=[];cols=[];vals=[]; b=np.zeros(nx*ny); diag=np.zeros_like(X)
    for dy,dx in [(0,1),(1,0)]:
        a=(slice(0,ny-dy),slice(0,nx-dx)); z=(slice(dy,ny),slice(dx,nx))
        # Harmonic face permittivity enforces normal displacement continuity.
        face=2*eps[a]*eps[z]/(eps[a]+eps[z])
        ia,iz=ids[a],ids[z]
        for here,there,mhere,mthere in [(ia,iz,metal[a],metal[z]),(iz,ia,metal[z],metal[a])]:
            free=~mhere
            rows.extend(here[free].ravel()); cols.extend(there[free].ravel()); vals.extend((-face[free]).ravel())
        diag[a]+=face;diag[z]+=face
    # Half-cell distance from first cell centre to grounded boundary.
    diag[:,0]+=2*eps[:,0];diag[0,:]+=2*eps[0,:]
    diag[metal]=1;b[ids[metal]]=1
    rows.extend(ids.ravel());cols.extend(ids.ravel());vals.extend(diag.ravel())
    A=coo_matrix((vals,(rows,cols)),shape=(nx*ny,nx*ny)).tocsr()
    v=spsolve(A,b).reshape(ny,nx)
    q=0.0
    for dy,dx in [(0,1),(1,0)]:
        a=(slice(0,ny-dy),slice(0,nx-dx)); z=(slice(dy,ny),slice(dx,nx))
        face=2*eps[a]*eps[z]/(eps[a]+eps[z])
        edge=metal[a]^metal[z]
        q+=np.sum(face[edge]*np.abs(v[a][edge]-v[z][edge]))
    return q*8.8541878128e-12

results=[]
for width,step,extent in [(.15,.005,1.2),(.15,.0025,1.2),(.15,.0025,1.6)]:
    c=capacitance(width,step,extent=extent); c0=capacitance(width,step,True,extent)
    results.append(dict(widthMm=width,gapMm=.17,gridMm=step,domainMm=extent,
      capacitancePFPerM=c*1e12,vacuumCapacitancePFPerM=c0*1e12,
      estimatedDifferentialOhms=2/(299792458*math.sqrt(c*c0))))
report={'method':__doc__,'stackup':'JLC06121H-3313; L1 referenced to uninterrupted L2 GND',
 'dielectricHeightMm':.0994,'copperThicknessMm':.035,'dielectricConstant':4.1,
 'maskEr':3.8,'maskAboveTraceMm':.01524,'maskAboveSubstrateMm':.03048,
 'limitations':'Uniform straight pair, rectangular copper, nominal materials. Excludes pads/bends, etch variation and dielectric tolerances. Fabricator impedance approval remains required.',
 'results':results}
Path('dist/usb-field-check.json').write_text(json.dumps(report,indent=2))
print(json.dumps(results,indent=2))
