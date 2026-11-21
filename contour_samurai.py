"""Local-space contour edits to the saved, skinned samurai in its A-pose."""
from pathlib import Path
import sys, math
import bpy
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0,str(Path(__file__).resolve().parent))
from contour_views import S,R,C,O,P,inspect
D=bpy.data
original_engine=S.render.engine
bpy.context.preferences.filepaths.save_version=0
S.frame_set(1)
def G(q,w):return math.exp(-(q/w)**2)
def sat(x):return min(1,max(0,x))
def ease(x):
    x=sat(x);return x*x*(3-2*x)
def shape(o,fn):
    m=o.matrix_world.copy();inv=m.inverted()
    for v in o.data.vertices:v.co=inv@Vector(fn(m@v.co))
    o.data.update()
def tree(o):return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[f.vertices[:] for f in o.data.polygons])
def front_y(b,x,z):
    hit=b.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))[0]
    return hit.y if hit is not None else -.085
def surface(name,rows,mat,bone):
    n=len(rows[0]);verts=[p for row in rows for p in row]
    faces=[(j*n+i,(j+1)*n+i,(j+1)*n+i+1,j*n+i+1) for j in range(len(rows)-1) for i in range(n-1)]
    me=D.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    ob=D.objects.new(name,me);S.collection.objects.link(ob);ob.parent=R;me.materials.append(D.materials[mat])
    for f in me.polygons:
        if f.normal.y>0:f.flip()
        f.use_smooth=True
    vg=ob.vertex_groups.new(name=bone);vg.add(list(range(len(verts))),1,'REPLACE')
    mod=ob.modifiers.new('Skin','ARMATURE');mod.object=R
    return ob
head=D.objects['head__Face_warm_skin']
old=tree(head)
def mouth(z,x):
    return (-.0091*G(z-1.560,.016)-.0039*G(z-1.571,.012)+.0018*G(z-1.580,.006)+.0012*G(z-1.543,.004))*G(x,.031)
def lids(x):
    t=sat((abs(x)-.016)/.044)
    a=max(.000001,math.sin(math.pi*t))**.83
    mid=1.6305+.0021*t
    return mid-.00465*a,mid+.0064*a
def globe(x,z):
    # Convex spherical section on a local tangent plane angled with the socket.
    r=.031
    dx=abs(x)-.037
    return -.070+.29*dx-math.sqrt(max(.00007,r*r-dx*dx-(z-1.632)**2))
def facial(p):
    x,y,z=p
    if y<-.04:
        y+=mouth(z,x)
        y+=.0052*G(z-1.598,.007)*G(x,.007)
        y-=.0015*G(z-1.595,.006)*G(abs(x)-.009,.006)
        # Malar plane rolls gently toward the mandibular angle under the ear.
        y-=.0027*G(abs(x)-.054,.019)*G(z-1.607,.013)
        y+=.0029*G(abs(x)-.060,.019)*G(z-1.565,.022)
        lo,hi=lids(x)
        outer=ease((abs(x)-.010)/.013)*ease((.068-abs(x))/.014)
        dz=z-lo
        # Suppress the vertical troughs at the canthi and blend to a single lower lid.
        if abs(dz)<.033 and outer>0:
            core=front_y(old,x,lo-.021)
            target=(globe(x,lo)-.00055)*G(dz,.010)+core*(1-G(dz,.010))
            below=ease((.0034-dz)/.0034)
            energy=outer*G(dz,.018)*below
            y=y*(1-energy)+target*energy
    # Carry the cheek inward below the zygoma, leaving the jaw angle perceptible.
    x*=1-.060*G(z-1.562,.023)*G(abs(x)-.070,.029)
    z+=.0035*G(x-.073,.020)*G(y-.004,.028)*G(z-1.544,.020)+.0035*G(x+.073,.020)*G(y-.004,.028)*G(z-1.544,.020)
    return x,y,z
shape(head,facial)
newskin=tree(head)
for ob in list(R.children):
    if ob.name.startswith(('Eye white ','Upper lid ','Upper lid margin ','Iris ','Pupil ')):D.objects.remove(ob,do_unlink=True)
    elif ob.name in ('Upper lip','Lower lip'):
        upper_lip=ob.name=='Upper lip'
        m=ob.matrix_world.copy();mi=m.inverted()
        for v in ob.data.vertices:
            x,y,z=m@v.co
            q=(v.index%8)/7
            reach=max(0,1-(x/.0264)**2)
            # The vermilion meets the facial surface at the outside border.
            bulge=(.0024*(1-q)+(.0034 if upper_lip else .0030)*math.sin(math.pi*q))*reach
            v.co=mi@Vector((x,front_y(newskin,x,z)-bulge-.00008,z))
        ob.data.update()
    elif ob.name.startswith('Nostril '):
        shape(ob,lambda p:(p.x,front_y(newskin,p.x,p.z)-.00024,p.z))
for s in (-1,1):
    eye=[];upper=[];lower=[]
    for i in range(65):
        t=(i+.001)/64.002;x=s*(.016+.044*t);lo,hi=lids(x)
        eye.append([(x,globe(x,z),z) for z in np.linspace(lo,hi,9)])
        for storage,z0,width in [(upper,hi,.009),(lower,lo,-.0050)]:
            row=[]
            for q in (0,.1,.23,.45,.7,.88,1):
                z=z0+width*q*(.17+.83*math.sin(math.pi*t))
                base=front_y(newskin,x,z)
                y=(1-ease(q))*(globe(x,z0)-.00030)+ease(q)*(base+.00010)-.0007*math.sin(math.pi*q)
                row.append((x,y,z))
            storage.append(row)
    surface('Eye white '+str(s),eye,'Muted eye whites','head')
    surface('Upper lid '+str(s),upper,'Face warm skin','head')
    surface('Palpebral rim '+str(s),lower,'Face warm skin','head')
    for rad,title,mat,offset in [(.0079,'Iris ','Deep brown irises',.00023),(.0035,'Pupil ','Black hair',.00042)]:
        rows=[]
        for t in np.linspace(-.9999,.9999,41):
            x=s*.037+s*t*rad
            h=rad*math.sqrt(1-t*t);lo,hi=lids(x)
            rows.append([(x,globe(x,z)-offset,z) for z in np.linspace(max(lo,1.632-h),min(hi,1.632+h),8)])
        surface(title+str(s),rows,mat,'head')

# Give the existing welded hand a cupped palm, diagonal knuckle arc and differentiated curls.
across=Vector((.44,.896,.025)).normalized();down=Vector((.10,-.075,-.992)).normalized()
normal=down.cross(across).normalized()
frame=Matrix((across,normal,down)).transposed()
inverse=frame.inverted();wrist=Vector((.419,-.010,.976))
for s,side in [(1,'L'),(-1,'R')]:
    def sculpt_hand(p):
        q=Vector((s*p.x,p.y,p.z))
        x,y,z=inverse@(q-wrist)
        palmar=ease((-y+.003)/.012)
        # Convex thenar and hypothenar cushions flank a shallow oblique palm hollow.
        y+=palmar*(.008*G(x-.001,.016)*G(z-.056,.023)-.0073*G(x+.021,.012)*G(z-.044,.024)-.0035*G(x-.024,.010)*G(z-.051,.019))
        y*=1+.11*G(z-.020,.021)-.16*G(z-.079,.017)
        for k,(xf,zf,length,bend,spread) in enumerate([(-.026,.082,.070,.009,-.004),(-.008,.087,.077,.013,-.002),(.010,.082,.072,.018,.001),(.027,.072,.061,.024,.003)]):
            if z<zf-.022:continue
            t=sat((z-zf)/length);xf+=spread*t
            influence=G(x-xf,.010)
            center_y=.002-.003*t-(.013,.021,.027,.029)[k]*t**1.8
            y-=.22*max(0,y-center_y)*ease((t-.65)/.25)*influence
            # Keep the terminal phalanx and nail bed broad and flat on the dorsal side.
            pivot=G(z-zf,.008)
            y+=influence*(.0027*pivot*ease((y+.002)/.011)-bend*t*t)
            z+=influence*((.001,.003,-.001,-.0035)[k]*G(z-zf,.040)-.005*t*t)
            x+=(x-xf)*(-.08*t*influence)
        q=frame@Vector((x,y,z))+wrist
        return s*q.x,q.y,q.z
    for ob in list(R.children):
        if ob.vertex_groups[0].name=='hand_'+side:shape(ob,sculpt_hand)
# A shoulder-weighted mask keeps sleeve and lower-neck positions stable while tailoring the torso.
def torso(p):
    x,y,z=p
    central=1-ease((abs(x)-.155)/.051)
    influence=central*ease((z-.993)/.034)*ease((1.476-z)/.056)
    width=.018*G(z-1.332,.061)-.095*G(z-1.088,.070)
    frontdepth=(.094 if y<0 else .113)*G(z-(1.306 if y<0 else 1.350),.087)-.089*G(z-1.087,.067)
    return x*(1+width*influence),y*(1+frontdepth*influence),z
for ob in R.children:
    if ob.name=='spine__Indigo_fabric' or ob.name.startswith(('Kimono lapel','chest__')):shape(ob,torso)
neck=D.objects['neck__Warm_skin']
shape(neck,lambda p:(p.x*(1+.13*G(p.z-1.46,.021)),p.y*(1+.055*G(p.z-1.46,.021)),p.z))

# Apply the same anatomical fit to both feet and their straps so they track the new contour.
for s,side in [(1,'L'),(-1,'R')]:
    def footform(p):
        x=s*p.x-.130;y=p.y;z=p.z
        fore=G(y+.134,.052)
        x*=1+.083*fore-.054*G(y+.039,.033)
        y+=.0040*G(y-.045,.038)
        heel=ease((y-.005)/.044)
        x*=1+.057*heel*G(z-.051,.019)-.077*heel*G(z-.084,.015)
        above=ease((z-.018)/.013)
        z+=above*(.0037*G(y+.114,.032)-.003*G(y-.035,.021))
        for i,(toe,reach,rad) in enumerate([(-.044,.194,.016),(-.015,.188,.0118),(.009,.179,.0103),(.028,.169,.0091),(.045,.157,.0079)]):
            tip=ease((-y-.139)/max(.012,reach-.139))*G(x-toe,rad)
            x+=tip*(x-toe)*(-.22 if i else -.10)
            z-=above*tip*.0022
            y-=tip*(.0030-.0012*i)
        return s*(.130+x),y,z
    for ob in R.children:
        if ob.vertex_groups[0].name=='foot_'+side:shape(ob,footform)
    skin=D.objects['foot_'+side+'__Warm_skin']
    sole=D.objects['foot_'+side+'__Sandal_sole']
    st=tree(sole)
    for v in skin.data.vertices:
        p=skin.matrix_world@v.co
        if p.z>.029:continue
        hit=st.ray_cast(Vector((p.x,p.y,.080)),Vector((0,0,-1)))[0]
        if hit and (p.y<-.102 or p.y>.028):
            v.co.z+=(hit.z-p.z)*ease((.029-p.z)/.008)
    skin.data.update()

bpy.context.view_layer.update()
inspect('after')
S.render.engine=original_engine
C.location=(0,-4,.93);C.rotation_euler=(Vector((0,0,.93))-C.location).to_track_quat('-Z','Y').to_euler()
C.data.ortho_scale=1.96;S.render.resolution_x=680;S.render.resolution_y=1024
S.render.filepath=str(O/'samurai_front.png');bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT')
R.select_set(True)
for ob in R.children:
    if ob.type=='MESH':ob.select_set(True)
bpy.context.view_layer.objects.active=R
bpy.ops.export_scene.gltf(filepath=str(O/'samurai_character.glb'),export_format='GLB',use_selection=True,export_animations=True,export_nla_strips=True,export_skins=True)
bpy.ops.wm.save_as_mainfile(filepath=str(O/'samurai_character.blend'))
