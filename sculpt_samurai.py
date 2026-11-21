"""Apply three geometry passes to the current saved samurai, then compare and export."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from samurai_views import bpy,scene,rig,root,cam,views,tree,pts
from mathutils import Vector,Matrix
import numpy as np
import bmesh, math
D=bpy.data
out=root.parent
G=lambda x,w: math.exp(-(x/w)**2)
clamp=lambda x:max(0,min(1,x))
original_engine=scene.render.engine
bpy.context.preferences.filepaths.save_version=0
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


def smooth_apply(ob,kind,**settings):
    bpy.context.view_layer.objects.active=ob
    mod=ob.modifiers.new(kind,kind)
    for k,v in settings.items():setattr(mod,k,v)
    bpy.ops.object.modifier_move_to_index(modifier=mod.name,index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)

# First pass. Add sampling only at the lid where a millimetre changes the silhouette.
head=D.objects['head__Face_warm_skin']
bm=bmesh.new()
bm.from_mesh(head.data)
selected=[]
for edge in bm.edges:
    p=head.matrix_world @ ((edge.verts[0].co+edge.verts[1].co)*.5)
    if .010<abs(p.x)<.070 and 1.609<p.z<1.637 and p.y<-.050:selected.append(edge)
bmesh.ops.subdivide_edges(bm,edges=selected,cuts=2,use_grid_fill=True)
bm.to_mesh(head.data)
bm.free()
def face_pass(p):
    x,y,z=p
    if y<-.035:
        u=(abs(x)-.016)/.044
        if 0<u<1:
            op=math.sin(math.pi*u)**.79
            rim=1.631+.002*u-.0050*op
            dz=z-rim
            target=.0022+.0032*G(abs(x)-.037,.018)*G(rim-1.632,.014)
            # Tight crest along the eye, broad transition below toward the cheek.
            if dz<0:
                depth=(target+.00065)*( .32*G(dz,.0028)+.68*G(dz,.010))
            else:
                depth=(target+.00065)*G(dz,.00125)
            y-=depth*clamp(u/.065)*clamp((1-u)/.065)
        y-=.0035*G(abs(x)-.046,.023)*G(z-1.612,.014)
        y+=.0018*G(abs(x)-.030,.027)*G(z-1.591,.017)
    jaw=G(z-1.558,.032)*G(abs(x)-.067,.032)
    return x*(1-.060*jaw),y,z
shape(head,face_pass)
for s in (-1,1):D.objects.remove(D.objects['Lower lid '+str(s)],do_unlink=True)
# Preserve skin continuity through the mandible and the existing chin-to-collar distance.

# Sample a smooth implicit hand in palm coordinates, then triangulate its zero surface.
# Smooth union creates a single skin through the thumb-index web and all knuckle roots.
def smooth_union(a,b,r):
    h=np.maximum(r-np.abs(a-b),0)/r
    return np.minimum(a,b)-.25*h*h*r

def extract(field,axes):
    offsets=np.array([(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)])
    inside=field<0
    corners=[inside[i:i+field.shape[0]-1,j:j+field.shape[1]-1,k:k+field.shape[2]-1] for i,j,k in offsets]
    cells=np.argwhere(np.logical_or.reduce(corners) & ~np.logical_and.reduce(corners))
    ids=np.ravel_multi_index((cells[:,None,:]+offsets[None,:,:]).transpose(2,0,1),field.shape)
    flat=field.ravel()
    vertices=[]; faces=[];cache={}
    def crossing(a,b):
        key=(min(a,b),max(a,b))
        if key not in cache:
            frac=flat[a]/(flat[a]-flat[b])
            ia=np.unravel_index(a,field.shape);ib=np.unravel_index(b,field.shape)
            cache[key]=len(vertices)
            vertices.append([axes[i][ia[i]]+frac*(axes[i][ib[i]]-axes[i][ia[i]]) for i in range(3)])
        return cache[key]
    for tet in [(0,1,2,6),(0,2,3,6),(0,3,7,6),(0,7,4,6),(0,4,5,6),(0,5,1,6)]:
        for nodes in ids[:,tet]:
            inside=nodes[flat[nodes]<0];outside=nodes[flat[nodes]>=0]
            if len(inside)==0 or len(outside)==0:continue
            if len(inside)==2:
                a,b,c,d=[crossing(i,j) for i in inside for j in outside]
                faces.extend([(a,b,d),(a,d,c)])
            else:
                faces.append(tuple(crossing(i,j) for i in inside for j in outside))
    return np.array(vertices),faces

step=.00170
axes=[np.arange(a,b,step) for a,b in [(-.083,.063),(-.068,.044),(-.035,.194)]]
X,Y,Z=np.meshgrid(*axes,indexing='ij',sparse=True)
def ellipsoid(cx,cy,cz,rx,ry,rz):
    ax=(X-cx)/rx;ay=(Y-cy)/ry;az=(Z-cz)/rz
    k=np.sqrt(ax*ax+ay*ay+az*az)
    grad=np.sqrt((ax/rx)**2+(ay/ry)**2+(az/rz)**2)
    return (k-1)*k/np.maximum(grad,1e-6)
def segment(a,b,r0,r1):
    v=np.array(b)-a
    t=np.clip(((X-a[0])*v[0]+(Y-a[1])*v[1]+(Z-a[2])*v[2])/np.dot(v,v),0,1)
    return np.sqrt((X-a[0]-t*v[0])**2+(Y-a[1]-t*v[1])**2+(Z-a[2]-t*v[2])**2)-(r0+t*(r1-r0))
field=ellipsoid(.001,0,.050,.0385,.021,.052)
field=smooth_union(field,ellipsoid(0,.001,.004,.024,.020,.028),.011)
field=smooth_union(field,ellipsoid(-.019,-.009,.046,.022,.021,.037),.012)
field=smooth_union(field,ellipsoid(.023,-.002,.052,.017,.016,.038),.010)
# Rounded first dorsal interosseous between the index metacarpal and thumb.
field=smooth_union(field,ellipsoid(-.028,-.003,.058,.021,.012,.027),.008)
digits=[]
for i,(base_x,base_z,rad,length,bend,spread) in enumerate([
        (-.026,.082,.0100,.070,.013,-.007),(-.008,.087,.0104,.077,.021,-.001),
        (.010,.082,.0096,.072,.027,.003),(.027,.072,.0084,.061,.029,.008)]):
    ctrs=[];rads=[]
    for t,rr in [(-.37,1.10),(-.14,1.04),(0,1.09),(.22,.91),(.43,.95),(.62,.80),(.72,.85),(.93,.74)]:
        ctrs.append((base_x+spread*max(t,0),.002-.003*t-bend*max(0,t)**1.8,base_z+length*t))
        rads.append(rad*rr)
    finger=segment(ctrs[0],ctrs[1],rads[0],rads[1])
    for j in range(1,len(ctrs)-1):
        finger=smooth_union(finger,segment(ctrs[j],ctrs[j+1],rads[j],rads[j+1]),.0016)
    field=smooth_union(field,finger,.0085)
    digits.append((np.array(ctrs[-1]),np.array(ctrs[-2]),rads[-1]))
thumb=[(-.016,-.008,.030),(-.032,-.012,.044),(-.046,-.017,.054),(-.055,-.022,.066),(-.058,-.030,.080),(-.056,-.035,.089)]
r=[.016,.0175,.014,.012,.0108,.0084]
for j in range(len(thumb)-1):field=smooth_union(field,segment(thumb[j],thumb[j+1],r[j],r[j+1]),.009 if j<2 else .003)
digits.append((np.array(thumb[-1]),np.array(thumb[-2]),r[-1]))
local,faces=extract(field,axes)
across=Vector((.44,.896,.025)).normalized();down=Vector((.10,-.075,-.992)).normalized()
dorsal=down.cross(across).normalized()
basis=Matrix((across,dorsal,down)).transposed()
for s,side in [(1,'L'),(-1,'R')]:
    bone='hand_'+side
    for ob in list(rig.children):
        if ob.vertex_groups[0].name==bone:D.objects.remove(ob,do_unlink=True)
    def hand(p):
        q=basis @ Vector(p)+Vector((.419,-.010,.976))
        q.x*=s
        return q
    ob=mesh(bone+'__Warm_skin',[hand(v) for v in local],faces,'Warm skin',bone)
    smooth_apply(ob,'DECIMATE',ratio=.19)
    surface=tree(ob)
    for i,(tip,prev,radius) in enumerate(digits):
        tangent=Vector(tip-prev).normalized()
        axis=tangent.cross(Vector((0,1,0))).normalized()
        up=axis.cross(tangent).normalized()
        if i==4:
            up=(up*.35-axis*.94).normalized();axis=tangent.cross(up).normalized()
        direction=basis@up;direction.x*=s
        center=Vector(tip)-tangent*.002
        outline=[]
        for fraction in (0,.25,.5,.75,1):
            for k in range(24):
                a=k*math.tau/24
                p=center+axis*(fraction*radius*.62*math.cos(a))+tangent*(fraction*radius*.87*math.sin(a))
                hit,normal,*_=surface.ray_cast(hand(p)+direction*.025,-direction)
                outline.append(hit+normal*.00017 if hit is not None else hand(p))
        # Use one center vertex for the nail bed.
        vertices=[outline[0]]+outline[24:]
        polys=[(0,k+1,(k+1)%24+1) for k in range(24)]
        polys += [(1+j*24+k,1+j*24+(k+1)%24,1+(j+1)*24+(k+1)%24,1+(j+1)*24+k) for j in range(3) for k in range(24)]
        mesh('Nail bed '+side+str(i),vertices,polys,'Natural nail beds',bone)
# Third pass. Build the clothed rib cage, then join the shoulder slopes to the sleeves.
torso=D.objects['spine__Indigo_fabric']
D.objects.remove(torso,do_unlink=True)
sections=[(.996,.145,.105,0),(1.035,.153,.109,.001),(1.090,.158,.115,.002),
          (1.145,.169,.124,.003),(1.21,.177,.140,.003),(1.275,.190,.153,.003),
          (1.326,.192,.158,.004),(1.363,.184,.153,.004),(1.394,.178,.145,.004),
          (1.423,.165,.118,.003),(1.446,.133,.095,.003),(1.469,.093,.073,.003),
          (1.482,.070,.057,0)]
rows=[]
for z,w,d,cy in sections:
    row=[]
    for i in range(56):
        a=i*math.tau/56
        fold=.004*math.sin(3*a+22*z)*G(z-1.095,.073)
        row.append(((w+fold)*math.cos(a),cy+(d+fold)*math.sin(a),z+.006*math.cos(2*a)*G(z-1.42,.045)))
    rows.append(row)
shirt=rings('Kimono rib cage',rows,'Indigo fabric','spine')
smooth_apply(shirt,'SUBSURF',levels=2)
union=[shirt]
for s,side in [(1,'L'),(-1,'R')]:
    union.append(D.objects['upper_arm_'+side+'__Indigo_fabric'])
    # Trapezius to deltoid: elliptical sections fall in height toward the shoulder joint.
    rowset=[]
    for x,z,w,h in [(.04,1.446,.047,.038),(.073,1.444,.065,.036),(.111,1.435,.075,.040),(.157,1.428,.074,.041),
                     (.188,1.422,.066,.043),(.212,1.410,.062,.041),(.237,1.391,.063,.038)]:
        rowset.append([(s*x,w*math.sin(i*math.tau/28),z+h*math.cos(i*math.tau/28)) for i in range(28)])
    union.append(rings('Shoulder slope',rowset,'Indigo fabric','chest'))
bpy.ops.object.select_all(action='DESELECT')
for ob in union:
    ob.select_set(True);ob.modifiers.clear()
bpy.context.view_layer.objects.active=shirt
bpy.ops.object.join()
smooth_apply(shirt,'REMESH',mode='VOXEL',voxel_size=.0048,use_smooth_shade=True)
smooth_apply(shirt,'SMOOTH',factor=.78,iterations=6)
smooth_apply(shirt,'DECIMATE',ratio=.28)
shirt.name='spine__Indigo_fabric'
shirt.vertex_groups.clear()
groups={name:shirt.vertex_groups.new(name=name) for name in ('spine','chest','upper_arm_L','upper_arm_R')}
for v in shirt.data.vertices:
    x,y,z=v.co
    # Below the armpit the sleeve can be close to the ribs: use the known sleeve axis.
    centerx=.19+(1.42-z)*.52
    armt=clamp((abs(x)-.167)/.068)*clamp((.098-math.hypot(abs(x)-centerx,y))/.035)
    armt=armt*armt*(3-2*armt)
    chest=clamp((z-1.18)/.17)*(1-armt)
    for n,w in [('upper_arm_L' if x>0 else 'upper_arm_R',armt),('chest',chest),('spine',1-armt-chest)]:
        if w>1e-6:groups[n].add([v.index],w,'REPLACE')
mod=shirt.modifiers.new('Humanoid skin','ARMATURE');mod.object=rig
for poly in shirt.data.polygons:poly.use_smooth=True
# The diagonal overlap of the kimono follows the actual front surface.
shirt_tree=tree(shirt)
for s in (-1,1):
    strip=[]
    for j in range(34):
        t=j/33
        xc=s*(.057*(1-t)-.044*t)
        z=1.469-.119*t
        row=[]
        for u in (-1,-.85,-.45,0,.5,.9,1):
            x=xc+u*.013
            hit=shirt_tree.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))[0]
            y=hit.y if hit else -.064
            row.append((x,y-.0022-.0025*math.cos(u*1.48)-(.002 if s==1 else 0),z))
        strip.append(row)
    w=len(strip[0])
    faces=[(j*w+i,(j+1)*w+i,(j+1)*w+i+1,j*w+i+1) for j in range(len(strip)-1) for i in range(w-1)]
    mesh('Kimono lapel '+str(s),sum(strip,[]),faces,'Indigo fabric','chest')

for ob in list(rig.children):
    n=ob.name
    if n.startswith('chest__') and any(k in n for k in ('lamellar','bronze','crimson')):
        def refit(p):
            x,y,z=p
            weight=G(z-1.309,.089)
            return x*(1+.023*weight),y*(1+.052*weight-.035*G(z-1.09,.046)),z
        shape(ob,refit)
# Recut the pleated trouser sections. Interpolated rings retain fold crests along the leg.
for s,side in [(1,'L'),(-1,'R')]:
    name='thigh_'+side+'__Charcoal_trousers'
    D.objects.remove(D.objects[name],do_unlink=True)
    profile=[(.423,.057,.061,.130,.003),(.431,.061,.066,.130,.003),(.441,.070,.076,.129,.008),
             (.455,.082,.089,.130,.011),(.467,.087,.099,.133,.012),(.479,.099,.109,.136,.009),
             (.493,.103,.113,.134,.013),(.511,.111,.116,.133,.014),(.548,.126,.127,.132,.013),
             (.590,.125,.127,.128,.013),(.634,.115,.121,.120,.011),(.684,.094,.109,.109,.008),
             (.755,.084,.101,.094,.006),(.837,.079,.095,.087,.004),(.910,.077,.090,.084,.003)]
    rows=[]
    for z,w,d,cx,amp in profile:
        row=[]
        for k in range(56):
            a=math.tau*k/56
            phase=5*a+s*(z-.51)*5+.42*math.sin(2*a+z*9)
            fold=amp*(.86*math.cos(phase)+.30*math.cos(2*phase)+.24*math.cos(8*a-z*4))
            gather=G(z-.482,.044)
            z1=z+.014*gather*math.sin(2*a+s*9*z)+.006*gather*math.cos(4*a-.7)
            row.append((s*cx+(w+fold)*math.cos(a),.004+(d+fold)*math.sin(a),z1))
        rows.append(row)
    leg=rings(name,rows,'Charcoal trousers','thigh_'+side)
    smooth_apply(leg,'SUBSURF',levels=1)
for ob in rig.children:
    if ob.type=='MESH' and not ob.data.uv_layers and any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in ob.data.materials):
        uv=ob.data.uv_layers.new(name='UVMap')
        for loop in ob.data.loops:
            p=ob.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=(p.x*6+p.z,p.y*6+p.z)
bpy.context.view_layer.update()
views('after')
# Save the same stage and full-character camera used on opening the source.
scene.render.engine=original_engine
cam.location=(0,-4,.93);cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=1.96
scene.render.resolution_x,scene.render.resolution_y=680,1024
scene.render.filepath=str(out/'samurai_front.png')
bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for ob in rig.children:
    if ob.type=='MESH':ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out/'samurai_character.glb'),export_format='GLB',use_selection=True,export_animations=True,export_nla_strips=True,export_skins=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'samurai_character.blend'))
