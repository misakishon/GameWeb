"""Fit the saved rigged samurai and render matched orthographic inspection views."""
import bpy
import bmesh
import math
import os
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import numpy as np

D = bpy.data
scene = bpy.context.scene
out = Path(__file__).resolve().parent / 'public' / 'models'
review = out / 'fit_review'
review.mkdir(exist_ok=True)
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
cam = scene.camera
source = list(rig.children)
bpy.context.preferences.filepaths.save_version = 0
scene.frame_set(1)
bpy.context.view_layer.update()
original_engine = scene.render.engine
scene.render.engine = 'BLENDER_WORKBENCH'
shade = scene.display.shading
shade.light = 'STUDIO'
shade.color_type = 'SINGLE'
shade.single_color = (.68,.64,.60)
shade.show_shadows = False
shade.show_cavity = True
shade.cavity_type = 'WORLD'
shade.cavity_ridge_factor = .8
shade.cavity_valley_factor = .9
shade.background_type = 'WORLD'
scene.world.color = (.12,.12,.12)
shade.show_specular_highlight = True
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.overlay.show_overlays = False

def shot(label,target,direction,scale,w,h):
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.location = Vector(target)+Vector(direction).normalized()*4
    cam.rotation_euler = (Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.resolution_x,scene.render.resolution_y = w,h
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(review/(label+'.png'))
    bpy.ops.render.render(write_still=True)

def full(stage):
    for name,direction in [('front',(0,-1,0)),('side',(1,0,0))]:
        shot(stage+'_'+name,(0,0,.93),direction,1.98,600,1024)
full('before')

def shape(obj,fn):
    m=obj.matrix_world.copy()
    inv=m.inverted()
    for v in obj.data.vertices:
        v.co=inv @ Vector(fn(m @ v.co))
    obj.data.update()

def mesh(name,verts,faces,mat,bone):
    data=D.meshes.new(name)
    data.from_pydata(verts,[],faces)
    data.update()
    bm=bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    ob=D.objects.new(name,data)
    scene.collection.objects.link(ob)
    ob.parent=rig
    data.materials.append(D.materials[mat])
    for p in data.polygons:p.use_smooth=True
    group=ob.vertex_groups.new(name=bone)
    group.add(list(range(len(verts))),1,'REPLACE')
    mod=ob.modifiers.new('Humanoid skin','ARMATURE')
    mod.object=rig
    return ob

def rings(name,rows,mat,bone):
    n=len(rows[0])
    faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
           for j in range(len(rows)-1) for i in range(n)]
    faces += [tuple(reversed(range(n))),tuple(range((len(rows)-1)*n,len(rows)*n))]
    return mesh(name,[p for row in rows for p in row],faces,mat,bone)

def tube(name,centers,radii,mat,bone,n=14):
    pts=list(map(Vector,centers))
    rows=[]
    for j,(c,(a,b)) in enumerate(zip(pts,radii)):
        t=(pts[min(j+1,len(pts)-1)]-pts[max(j-1,0)]).normalized()
        if j==0:
            u=t.cross(Vector((0,1,0)) if abs(t.y)<.9 else Vector((1,0,0))).normalized()
        else:u=(u-t*u.dot(t)).normalized()
        v=t.cross(u)
        rows.append([c+a*math.cos(i*math.tau/n)*u+b*math.sin(i*math.tau/n)*v for i in range(n)])
    return rings(name,rows,mat,bone)

def remove(ob):
    D.objects.remove(ob,do_unlink=True)

def subdivide(ob,levels):
    bpy.context.view_layer.objects.active=ob
    mod=ob.modifiers.new('Contour smoothing','SUBSURF')
    mod.levels=levels
    bpy.ops.object.modifier_move_to_index(modifier=mod.name,index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)

def island_filter(ob,discard):
    bm=bmesh.new()
    bm.from_mesh(ob.data)
    todo=set(bm.verts)
    drop=[]
    while todo:
        first=todo.pop()
        island=[first]
        for v in island:
            for edge in v.link_edges:
                w=edge.other_vert(v)
                if w in todo:
                    todo.remove(w)
                    island.append(w)
        if discard(island,[ob.matrix_world @ v.co for v in island]):drop.extend(island)
    bmesh.ops.delete(bm,geom=drop,context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()

skin='Warm skin'
face='Face warm skin'
hair='Black hair'
lip='Natural muted lips'
red='Ox-blood crimson bindings'
sole='Straw soles'
nailmat=D.materials[skin].copy()
nailmat.name='Natural nail beds'
nailmat.diffuse_color=(.53,.32,.25,1)
next(n for n in nailmat.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value=nailmat.diffuse_color
drop=.018
# Head features share a single rigid translation after the local sculpt.
head=D.objects['head__Face_warm_skin']
island_filter(head,lambda island,pts: len(island)<100 and abs(sum(p.x for p in pts)/len(pts))<.025)
subdivide(head,2)
def sculpt(p):
    x,y,z=p
    if y<-.035:
        h=z+.032
        gauss=lambda center,width: math.exp(-((h-center)/width)**2)
        # A broad, rounded tip flows into narrower nasal bones and paired alae.
        blend=math.exp(-(x/.030)**4)*gauss(1.657,.039)
        target=-.098+.8*x*x-.016*math.exp(-(x/.010)**2)*gauss(1.666,.029)
        target-=.020*math.exp(-(x/.015)**2)*gauss(1.645,.013)
        target-=.013*math.exp(-((abs(x)-.013)/.006)**2)*gauss(1.641,.008)
        y=y*(1-blend)+target*blend
        y-=.005*math.exp(-(x/.028)**2)*gauss(1.617,.018)
        y-=.008*math.exp(-(x/.040)**2)*gauss(1.574,.014)
        y-=.004*math.exp(-((abs(x)-.051)/.020)**2)*gauss(1.657,.020)
        x*=1+.035*gauss(1.602,.018)
    return x,y,z
shape(head,sculpt)
for ob in source[:]:
    if ob.name.startswith('head__') and ob!=head:
        if ob.name.split('__')[1] in ('Deep_brown_irises','Muted_eye_whites','Face_contour','Natural_muted_lips'):
            remove(ob)
        elif ob.name=='head__Black_hair':
            island_filter(ob,lambda group,pts:max(p.z for p in pts)<1.674 and max(p.y for p in pts)<-.065)
            subdivide(ob,1)
        elif ob.name=='head__Hair_strand_variation':
            subdivide(ob,1)
verts=[head.matrix_world @ v.co for v in head.data.vertices]
surface=BVHTree.FromPolygons(verts,[p.vertices[:] for p in head.data.polygons])
def facial_y(x,z):
    hit,*_=surface.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))
    return hit.y if hit else -.09
for sign in (-1,1):
    upper=[];lower=[]
    rows=[]
    for i in range(25):
        u=i/24
        x=sign*(.016+.044*u)
        mid=1.649+.0016*u
        opening=math.sin(math.pi*u)**.75
        ztop=mid+.0058*opening
        zbot=mid-.0040*opening
        def pos(z):return Vector((x,facial_y(x,z)-.0015-.0017*opening,z))
        upper.append(pos(ztop));lower.append(pos(zbot))
        rows.append([pos(zbot+(ztop-zbot)*j/6) for j in range(7)])
    faces=[(i*7+j,(i+1)*7+j,(i+1)*7+j+1,i*7+j+1) for i in range(24) for j in range(6)]
    eye=mesh('Eye aperture '+str(sign),[p for row in rows for p in row],faces,'Muted eye whites','head')
    eye.data.materials.append(D.materials['Deep brown irises'])
    eye.data.materials.append(D.materials[hair])
    for poly in eye.data.polygons:
        p=poly.center
        d=math.hypot(abs(p.x)-.037,p.z-1.650)
        poly.material_index=0
    for radius,mat,depth in [(.0067,'Deep brown irises',.0004),(.0031,hair,.00065)]:
        pts=[]
        for k in range(48):
            a=k*math.tau/48
            x=sign*(.037+radius*math.cos(a))
            u=(abs(x)-.016)/.044
            op=math.sin(math.pi*u)**.75
            mid=1.649+.0016*u
            z=max(mid-.004*op+.0001,min(mid+.0058*op-.0001,1.650+radius*math.sin(a)))
            pts.append((x,facial_y(x,z)-.0015-.0017*op-depth,z))
        # Drape a triangulated fan over the eye rather than filling a flat disc.
        center=Vector((sign*.037,facial_y(sign*.037,1.650)-.0034-depth,1.650))
        mesh(mat+' '+str(sign),[center]+pts,[(0,k+1,(k+1)%48+1) for k in range(48)],mat,'head')
    for line,thick,title in [(upper,.0026,'Upper eyelid'),(lower,.0016,'Lower eyelid')]:
        tube(title+str(sign),line,[(thick*(.3+.7*math.sin(i*math.pi/24)),thick) for i in range(25)],face,'head',10)
    brow=[]
    for i in range(11):
        u=i/10;x=sign*(.015+.049*u);z=1.665+.005*u+.002*math.sin(math.pi*u)
        brow.append((x,facial_y(x,z)-.002,z))
    tube('Straight brow '+str(sign),brow,[(.001+.004*math.sin(math.pi*(i+.8)/12),.0023) for i in range(11)],hair,'head')
    nostril=[]
    for i in range(12):
        a=math.tau*i/12
        x=sign*(.010+.0031*math.cos(a))
        z=1.6065+.00135*math.sin(a)
        nostril.append((x,facial_y(x,z)-.00035,z))
    mesh('Nostril '+str(sign),nostril,[tuple(range(12))],'Face contour','head')
for upper in [True,False]:
    pts=[]
    for i in range(33):
        t=(i-16)/16;x=.025*t
        reach=(1-t*t)
        seam=1.576+.0017*t*t
        for j in range(8):
            v=j/7
            height=(.007-.0025*math.exp(-(t/.20)**2)) if upper else -.0068
            z=seam+v*height*reach+(.00022 if upper else -.00022)
            bulge=(.0035*(1-v)+.0045*math.sin(v*math.pi)) * reach
            pts.append((x,facial_y(x,z)-bulge-.0002,z))
    faces=[(i*8+j,(i+1)*8+j,(i+1)*8+j+1,i*8+j+1) for i in range(32) for j in range(7)]
    mesh('Upper lip' if upper else 'Lower lip',pts,faces,lip,'head')
for ob in list(rig.children):
    if ob.type=='MESH' and ob.vertex_groups[0].name=='head':
        ob.location.z-=drop
        ob.location.y+=.004
# Compress from a fixed collarbone plane and flare the lowest neck rings.
def neck(p):
    x,y,z=p
    w=math.exp(-((z-1.457)/.030)**2)
    return x*(1+.42*w),y*(1+.14*w),1.43+(z-1.43)*.77
shape(D.objects['neck__Warm_skin'],neck)
for name in ['chest__White_kimono_collar','chest__Indigo_fabric']:remove(D.objects[name])
# Draped collar with a low V in front and a standing edge at the nape.
for title,material,bias in [('Outer collar','Indigo fabric',0),('Inner binding','White kimono collar',.003)]:
    rows=[]
    for level in (0,.14,.80,1):
        row=[]
        for i in range(64):
            a=math.tau*i/64
            front=max(0,-math.sin(a))
            top=1.510-.033*front**6
            h=top+(.005 if bias else 0)-(1-level)*(.012 if bias else .051)
            rx=.061+.061*(1-level)*(0.16 if bias else 1)-bias
            ry=.058+.044*(1-level)*(0.16 if bias else 1)-bias
            row.append((rx*math.cos(a),-.007+ry*math.sin(a),h))
        rows.append(row)
    # Collar is an open tube; bridge back down an inner wall.
    inner=[[(x*.96,y*.96,z-.001) for x,y,z in row] for row in reversed(rows)]
    allrows=rows+inner
    count=64
    faces=[(j*count+i,j*count+(i+1)%count,((j+1)%8)*count+(i+1)%count,((j+1)%8)*count+i) for j in range(8) for i in range(count)]
    mesh(title,[p for row in allrows for p in row],faces,material,'chest')
def fuse(objects,name,bone,voxel):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
        ob.modifiers.clear()
    ob=objects[0]
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.join()
    # An implicit union joins the finger webs, thumb mound, toes and heel.
    for kind,settings in [('REMESH',{'mode':'VOXEL','voxel_size':voxel,'use_smooth_shade':True}),
                          ('SMOOTH',{'factor':.59,'iterations':4}),
                          ('DECIMATE',{'ratio':.34})]:
        mod=ob.modifiers.new(kind,kind)
        for key,val in settings.items():setattr(mod,key,val)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.name=name
    ob.vertex_groups.clear()
    ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))),1,'REPLACE')
    mod=ob.modifiers.new('Humanoid skin','ARMATURE');mod.object=rig
    for p in ob.data.polygons:p.use_smooth=True
    return ob

for s,side in [(1,'L'),(-1,'R')]:
    bone='hand_'+side
    remove(D.objects[bone+'__Warm_skin'])
    # Mirrored anatomical coordinates: thumb lies on the anterior side.
    origin=Vector((.419,-.010,.976))
    across=Vector((.44,.896,.025)).normalized()
    down=Vector((.10,-.075,-.992)).normalized()
    normal=down.cross(across).normalized()
    def hand(x,y,z):
        p=origin+across*x+normal*y+down*z
        return (s*p.x,p.y,p.z)
    rows=[]
    for z,w,d,shift in [(-.010,.022,.017,0),(.001,.023,.018,0),(.023,.032,.020,-.003),
                          (.046,.039,.021,-.002),(.066,.041,.018,0),(.086,.038,.016,.001),
                          (.093,.032,.012,.001)]:
        rows.append([hand(shift+w*math.cos(a*math.tau/32),d*math.sin(a*math.tau/32),z)
                     for a in range(32)])
    pieces=[rings('Palm',rows,skin,bone)]
    nail_outlines=[]
    for i,(offset,length,r,spread) in enumerate([(-.027,.075,.010,-.006),(-.009,.083,.0102,-.002),(.010,.078,.0094,.002),(.028,.061,.0082,.008)]):
        rows=[]
        for t,rr in [(0,.92),(.15,1),(.36,.92),(.46,.97),(.56,.84),(.72,.80),(.78,.83),(.90,.76),(.96,.61),(1,.15)]:
            x=offset+spread*t
            y=-.002-.005*t-.018*t*t
            z=.078+length*t-(.004 if i==3 else 0)
            rows.append([hand(x+r*rr*math.cos(k*math.tau/16),y+r*rr*.88*math.sin(k*math.tau/16),z) for k in range(16)])
        pieces.append(rings('Relaxed finger',rows,skin,bone))
        nail=[]
        for k in range(20):
            a=math.tau*k/20
            t=.852+.083*math.sin(a)
            dx=.59*r*math.cos(a)
            x=offset+spread*t+dx
            y=-.002-.005*t-.018*t*t+.88*r*.78*math.sqrt(max(.08,1-(dx/(r*.80))**2))
            nail.append(hand(x,y+.00045,.078+length*t-(.004 if i==3 else 0)))
        nail_outlines.append(nail)
    pts=[hand(x,y,z) for x,y,z in [(-.012,-.008,.021),(-.025,-.011,.037),(-.038,-.015,.049),(-.048,-.019,.061),(-.055,-.027,.078),(-.055,-.034,.090),(-.053,-.035,.094)]]
    pieces.append(tube('Thenar and thumb',pts,[(.012,.010),(.023,.018),(.018,.015),(.013,.012),(.011,.010),(.008,.008),(.003,.004)],skin,bone))
    palm=fuse(pieces,bone+'__Warm_skin',bone,.00165)
    def conform_nail(obj,outline,direction,title):
        tree=BVHTree.FromPolygons([v.co for v in obj.data.vertices],[p.vertices[:] for p in obj.data.polygons])
        center=sum(map(Vector,outline),Vector())/len(outline)
        pts=[]
        for p in [center]+[center.lerp(Vector(edge),r) for r in (.25,.50,.75,1.) for edge in outline]:
            hit,*_=tree.ray_cast(p+.018*direction,-direction)
            pts.append((hit if hit is not None else p)+.00048*direction)
        n=len(outline)
        faces=[(0,k+1,(k+1)%n+1) for k in range(n)]
        faces.extend((1+j*n+k,1+j*n+(k+1)%n,1+(j+1)*n+(k+1)%n,1+(j+1)*n+k) for j in range(3) for k in range(n))
        mesh(title,pts,faces,nailmat.name,bone)
    dorsal=Vector((s*normal.x,normal.y,normal.z))
    for i,outline in enumerate(nail_outlines):conform_nail(palm,outline,dorsal,'Finger nail '+side+str(i))

    bone='foot_'+side
    remove(D.objects[bone+'__Warm_skin'])
    remove(D.objects[bone+'__Straw_soles'])
    def foot(x,y,z):return (s*(.130+x),y,z)
    # Cross sections progress from the heel to the ball. First toe is medial.
    sections=[(.075,.012,.029,.063,0),(.065,.032,.020,.082,0),(.043,.040,.018,.104,0),
              (.010,.040,.020,.125,0),(-.020,.037,.024,.121,.003),(-.052,.039,.027,.097,.006),
              (-.083,.049,.022,.078,.005),(-.111,.054,.018,.065,.002),(-.134,.051,.018,.052,0),(-.145,.044,.019,.045,0)]
    def section(p):
        y,w,b,t,c=p
        return [foot(c+w*math.cos(k*math.tau/32),y,(b+t)/2+(t-b)/2*math.sin(k*math.tau/32)) for k in range(32)]
    pieces=[rings('Instep',list(map(section,sections)),skin,bone)]
    toes=[(-.040,.014,.194),(-.015,.0115,.190),(.006,.010,.181),(.025,.0095,.170),(.042,.0088,.159)]
    for x,r,reach in toes:
        rows=[]
        for t,fac in [(0,.76),(.19,1),(.48,.86),(.68,.91),(.86,.85),(.96,.58),(1,.12)]:
            y=-.129+(-reach+.129)*t
            rows.append([foot(x+r*fac*math.cos(k*math.tau/16),y,.019+.010*fac+.010*fac*math.sin(k*math.tau/16)) for k in range(16)])
        pieces.append(rings('Toe',rows,skin,bone))
    footmesh=fuse(pieces,bone+'__Warm_skin',bone,.00165)
    for i,(x,r,reach) in enumerate(toes):
        outline=[foot(x+.59*r*math.cos(a*math.tau/20),-reach+.008+.005*math.sin(a*math.tau/20),.038) for a in range(20)]
        conform_nail(footmesh,outline,Vector((0,0,1)),'Toe nail '+side+str(i))
    outline=[(.080,.012,0),(.073,.030,0),(.058,.043,0),(.025,.047,0),(-.018,.044,.002),(-.050,.044,.003),
             (-.088,.054,.002),(-.118,.060,0),(-.146,.061,-.001),(-.165,.055,-.006),(-.186,.043,-.015),(-.201,.025,-.029),(-.203,.012,-.034)]
    edge=[(c+w,y) for y,w,c in outline]+[(c-w,y) for y,w,c in reversed(outline)]
    rows=[[foot(x*f,y,z) for x,y in edge] for z,f in [(0,.96),(.003,1),(.015,1),(.019,.965)]]
    rings(bone+'__Sandal_sole',rows,sole,bone)
    tree=BVHTree.FromPolygons([v.co for v in footmesh.data.vertices],[p.vertices[:] for p in footmesh.data.polygons])
    for mid,width,title in [(-.120,.014,'Forefoot'),(-.030,.012,'Instep')]:
        rows=[]
        for i in range(33):
            a=math.pi*i/32
            strip=[]
            for edgewidth in [-width/2,-width*.36,width*.36,width/2]:
                y=mid+edgewidth+(.009 if mid<-.1 else .022)*math.cos(a)
                origin=Vector(foot(0,y,.042 if mid<-.1 else .056))
                theta=-.50+(math.pi+1.0)*i/32
                radial=Vector((s*math.cos(theta),0,math.sin(theta)))
                hit,*_=tree.ray_cast(origin+radial*.22,-radial)
                p=hit+radial*.002 if hit else origin+radial*.045
                if i in (0,32):p.z=.018
                strip.append(p)
            rows.append(strip)
        ff=[(i*4+j,(i+1)*4+j,(i+1)*4+j+1,i*4+j+1) for i in range(32) for j in range(3)]
        band=mesh(title+' strap '+side,[p for row in rows for p in row],ff,sole,bone)
        band.modifiers.new('Leather thickness','SOLIDIFY').thickness=.0024
    rows=[]
    for i in range(41):
        a=math.pi*i/40
        radial=Vector((s*math.cos(a),math.sin(a),0))
        strip=[]
        for width in [-.006,-.004,.004,.006]:
            z=.027+.037*math.sin(a)+width
            center=Vector(foot(0,-.031,z))
            hit,*_=tree.ray_cast(center+.20*radial,-radial)
            strip.append((hit if hit is not None else center+.047*radial)+.0025*radial)
        rows.append(strip)
    ff=[(i*4+j,(i+1)*4+j,(i+1)*4+j+1,i*4+j+1) for i in range(40) for j in range(3)]
    sling=mesh('Heel sling '+side,[p for row in rows for p in row],ff,sole,bone)
    sling.modifiers.new('Leather thickness','SOLIDIFY').thickness=.0024

# Fit the outer edge and its lacing as a single contour.
for ob in list(rig.children):
    n=ob.name
    if n.startswith('upper_arm_') and 'Indigo' not in n:
        s=1 if '_L__' in n else -1
        shape(ob,lambda p:(p.x-s*.006,p.y,p.z-.0025))
    elif n.startswith('chest__') and any(k in n for k in ('lamellar','bronze','crimson')):
        def chest(p):
            t=max(0,min(1,(p.z-1.080)/.31))
            return p.x*(.955+.075*t),p.y*(1+.045*math.sin(math.pi*t)),p.z
        shape(ob,chest)
    elif n.startswith('forearm_'):
        s=1 if '_L__' in n else -1
        def bracer(p):
            t=max(0,min(1,(1.19-p.z)/.22))
            cx=s*(.31+.11*t);cy=.01-.02*t
            return cx+(p.x-cx)*(1-.09*t),cy+(p.y-cy)*(1-.09*t),p.z
        shape(ob,bracer)
    elif n.startswith('shin_'):
        s=1 if '_L__' in n else -1
        def calf(p):
            f=1+.055*math.exp(-((p.z-.325)/.072)**2)-.055*math.exp(-((p.z-.13)/.06)**2)
            return .130*s+(p.x-.130*s)*f,p.y*f,p.z
        shape(ob,calf)
    elif n.startswith('thigh_'):
        s=1 if '_L__' in n else -1
        def pleat(p):
            x=p.x-.127*s
            a=math.atan2(p.y,x)
            w=math.exp(-((p.z-.58)/.105)**2)
            f=1+.048*w*math.cos(5*a+s*6*p.z)
            return .127*s+x*f,p.y*f,p.z+.005*w*math.cos(3*a+p.z*8)
        shape(ob,pleat)

obi=D.objects['pelvis__Ox-blood_crimson_bindings']
# Remove only the old central knot and the decorative ridges laying on it.
island_filter(obi,lambda vs,ps: max(p.y for p in ps)<-.118 and min(p.z for p in ps)>.96 and max(p.z for p in ps)<1.047 and max(abs(p.x) for p in ps)<.084)
rows=[]
for i,(x,height,depth,twist) in enumerate([(-.055,.028,.015,-.23),(-.047,.029,.019,-.18),(-.033,.031,.021,-.10),(-.020,.032,.019,0),(-.008,.032,.022,.12),(.007,.029,.020,.19),(.016,.025,.014,.25)]):
    row=[]
    for j in range(24):
        a=j*math.tau/24
        f=lambda v:math.copysign(abs(v)**.55,v)
        z=height*f(math.sin(a))
        row.append((x+twist*z,-.161-depth*f(math.cos(a))-.002*math.cos(i*1.9+a),1.003+z))
    rows.append(row)
rings('Folded obi knot',rows,red,'pelvis')
# Give the separate hip panels a little more space at the lower hem.
for ob in list(rig.children):
    if ob.name.startswith('pelvis__') and any(x in ob.name for x in ('lamellar','bronze','crimson')):
        def skirt(p):
            t=max(0,min(1,(.962-p.z)/.26))
            if abs(p.x)<.07 and p.y<-.15:return p
            return p.x*(1+.018*t),p.y*(1+.018*t),p.z
        shape(ob,skirt)
bpy.context.view_layer.update()
for ob in rig.children:
    if ob.type=='MESH' and not ob.data.uv_layers and any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in ob.data.materials):
        uv=ob.data.uv_layers.new(name='UVMap')
        for loop in ob.data.loops:
            p=ob.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=(p.x*6+p.z,p.y*6+p.z)
full('after')
shade.color_type='MATERIAL'
shade.show_specular_highlight=False
shot('face_profile',(0,-.002,1.665),(1,0,0),.429,720,780)
shot('face_front',(0,-.003,1.664),(.05,-1,0),.429,720,780)
def detail_visibility(allowed):
    for ob in rig.children:
        if ob.type=='MESH':ob.hide_render=not ob.vertex_groups[0].name.startswith(allowed)
detail_visibility(('forearm_L','hand_L'))
shot('left_hand',(.428,-.020,.899),(.88,-.47,.03),.224,560,680)
detail_visibility(('forearm_R','hand_R'))
shot('right_hand',(-.428,-.020,.899),(.88,.47,-.02),.224,560,680)
detail_visibility(('shin','foot'))
shot('sandals',(0,-.050,.058),(.23,-1,.48),.55,940,465)
detail_visibility(('shin_L','foot_L'))
shot('foot_profile',(.13,-.056,.071),(1,-.03,.095),.345,800,465)
detail_visibility(('',))
shade.color_type='SINGLE'
shade.show_specular_highlight=True
shot('after_back',(0,0,.93),(0,1,0),1.98,600,1024)

def sheet(name,labels):
    arrays=[]
    for label in labels:
        im=D.images.load(str(review/(label+'.png')))
        w,h=im.size
        a=np.empty(w*h*4,dtype=np.float32)
        im.pixels.foreach_get(a)
        arrays.append(a.reshape(h,w,4))
        D.images.remove(im)
    grid=np.concatenate(arrays,axis=1)
    im=D.images.new(name,width=grid.shape[1],height=grid.shape[0],alpha=True)
    im.pixels.foreach_set(grid.ravel())
    im.filepath_raw=str(review/(name+'.png'))
    im.file_format='PNG'
    im.save()
    D.images.remove(im)
sheet('front_comparison',['before_front','after_front'])
sheet('side_comparison',['before_side','after_side'])
sheet('hands',['right_hand','left_hand'])
sheet('face',['face_front','face_profile'])
sheet('feet',['sandals','foot_profile'])
sheet('full_body',['after_front','after_side','after_back'])
from shutil import copyfile
for view in ('front','side','back'):
    copyfile(review/('after_'+view+'.png'),out/('samurai_solid_'+view+'.png'))
copyfile(review/'full_body.png',out/'samurai_solid_turnaround.png')
scene.render.engine=original_engine
scene.cycles.samples=10
for name,angle in [('front',(0,-1,0)),('side',(1,0,0)),('back',(0,1,0)),('three_quarter',(.60,-1,.04))]:
    shot('studio_'+name,(0,0,.93),angle,1.98,600,1024)
    copyfile(review/('studio_'+name+'.png'),out/('samurai_'+name+'.png'))
sheet('studio_turnaround',['studio_front','studio_side','studio_back'])
copyfile(review/'studio_turnaround.png',out/'samurai_turnaround_cycles.png')
# Store the character open on the front view.
cam.location=(0,-4,.93)
cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=1.98
scene.render.engine=original_engine
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for ob in rig.children:
    if ob.type=='MESH':ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out/'samurai_character.glb'),export_format='GLB',use_selection=True,export_animations=True,export_nla_strips=True,export_skins=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'samurai_character.blend'))
