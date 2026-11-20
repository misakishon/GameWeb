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
review = out / 'surface_review'
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
nailmat=D.materials['Natural nail beds']

# Work in the coordinates of the rig's rest pose.
G=lambda x,w: math.exp(-(x/w)**2)
clamp=lambda x: max(0,min(1,x))
head=D.objects['head__Face_warm_skin']
def sculpt(p):
    x,y,z=p
    if y<-.035:
        # Fill the tear trough and reduce the angular shelf over the cheekbone.
        y-=.0046*G(abs(x)-.041,.022)*G(z-1.620,.010)
        y+=.0018*G(abs(x)-.051,.020)*G(z-1.606,.013)
        y-=.0040*G(abs(x)-.013,.0065)*G(z-1.592,.0060)
        y-=.0025*G(x,.012)*G(z-1.594,.0085)
    return x,y,z
shape(head,sculpt)
def tree(obj):
    return BVHTree.FromPolygons([obj.matrix_world @ v.co for v in obj.data.vertices],[p.vertices[:] for p in obj.data.polygons])
surf=tree(head)
def skin_y(x,z):
    hit=surf.ray_cast(Vector((x,-.5,z)),Vector((0,1,0)))[0]
    return hit.y
for ob in list(rig.children):
    if ob.name.startswith(('Eye aperture','Deep brown irises ','Black hair ','Upper eyelid','Lower eyelid','Nostril ')):
        remove(ob)
for title in ('Upper lip','Lower lip'):
    ob=D.objects[title]
    def corners(p):
        x,y,z=p
        weight=clamp((abs(x)-.008)/.017)**1.4
        return x*(1+.055*weight),y+.0024*weight,1.559+(z-1.559)*(1-.68*weight)
    shape(ob,corners)
for s in (-1,1):
    centerx=s*.037
    centerz=1.632
    front=skin_y(centerx,centerz)-.0042
    def eyeball(x,z):
        # The nasal corner rides over the bridge; keep the full aperture visible there.
        return skin_y(x,z)-.0022-.0032*G(x-centerx,.018)*G(z-centerz,.014)
    def edges(x):
        t=clamp((s*x-.016)/.044)
        op=math.sin(math.pi*t)**.79
        mid=centerz-.0013+.002*t
        return mid-.0050*op,mid+.0058*op
    def patch(name,rows,material):
        w=len(rows[0])
        return mesh(name,[p for row in rows for p in row],[(i*w+j,(i+1)*w+j,(i+1)*w+j+1,i*w+j+1) for i in range(len(rows)-1) for j in range(w-1)],material,'head')
    eye=[];upper=[];lower=[]
    for i in range(49):
        t=(i+.001)/48.002
        x=s*(.016+.044*t)
        lo,hi=edges(x)
        eye.append([(x,eyeball(x,z),z) for z in np.linspace(lo,hi,9)])
        for target,zedge,dz in [(upper,hi,.008),(lower,lo,-.009)]:
            row=[]
            for v in (0,.09,.22,.43,.65,.83,1):
                z=zedge+dz*v*(.25+.75*math.sin(t*math.pi))
                end=skin_y(x,z)
                y0=eyeball(x,zedge)-.0006
                ease=v*v*(3-2*v)
                y=(1-ease)*y0+ease*(end+.00055)-.0014*math.sin(math.pi*v)*(1-v)
                row.append((x,y,z))
            target.append(row)
    patch('Eye white '+str(s),eye,'Muted eye whites')
    patch('Upper lid '+str(s),upper,face)
    patch('Lower lid '+str(s),lower,face)
    lash=[Vector(row[0])+Vector((0,-.0002,0)) for row in upper]
    tube('Upper lid margin '+str(s),lash,[(.00022+.00055*math.sin(i*math.pi/48),.00055) for i in range(49)],'Face contour','head',8)
    # Orient both iris axes at one point on the forward midline. The visible upper iris is cropped by the lid margin.
    center=Vector((centerx,front,centerz))
    gaze=(Vector((0,-4,centerz))-center).normalized()
    center+=.022*gaze
    cx=center.x
    for radius,mat,depth in [(.0074,'Deep brown irises',.00016),(.00345,'Black hair',.00032)]:
        rows=[]
        for i in range(37):
            t=(i+.001)/36.002
            x=cx+radius*(2*t-1)
            half=radius*math.sqrt(max(0,1-(2*t-1)**2))
            lo,hi=edges(x)
            row=[]
            for z in np.linspace(max(lo,centerz-half),min(hi,centerz+half),9):
                row.append((x,eyeball(x,z)-depth,z))
            rows.append(row)
        patch(('Iris ' if radius>.005 else 'Pupil ')+str(s),rows,mat)
    nostril=[]
    for i in range(24):
        a=math.tau*i/24
        x=s*(.0108+.0032*math.cos(a))
        z=1.5884+.0012*math.sin(a)+.00055*math.cos(a)
        nostril.append((x,skin_y(x,z)-.00024,z))
    mesh('Nostril '+str(s),nostril,[tuple(range(24))],'Face contour','head')
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
                          ('SMOOTH',{'factor':.59,'iterations':8}),
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
    for ob in list(rig.children):
        if ob.vertex_groups[0].name==bone:remove(ob)
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
                          (.044,.037,.020,-.002),(.059,.040,.018,0),(.070,.038,.015,.001),
                          (.077,.032,.012,.001),(.082,.024,.007,.001),(.084,.013,.004,0)]:
        rows.append([hand(shift+w*math.cos(a*math.tau/32),d*math.sin(a*math.tau/32),z-max(0,z-.048)*.24*(math.cos(a*math.tau/32)+.25)**2)
                     for a in range(32)])
    pieces=[rings('Palm',rows,skin,bone)]
    nail_outlines=[]
    for i,(offset,length,r,spread) in enumerate([(-.027,.075,.010,-.006),(-.009,.083,.0102,-.002),(.010,.078,.0094,.002),(.028,.061,.0082,.008)]):
        base=(.074,.078,.074,.064)[i]
        curl=(.014,.020,.026,.030)[i]
        # Metacarpal pads extend into the palm, producing rounded knuckle heads and shallow webs.
        ridge=[hand(offset*.70,.004,.036),hand(offset*.91,.004,base-.016),hand(offset,.002,base-.004),hand(offset+.001,-.002,base+.005),hand(offset+.001,-.003,base+.014)]
        pieces.append(tube('Metacarpal',ridge,[(r*.95,r*.66),(r*1.16,r*.91),(r*1.09,r*.94),(r*.83,r*.65),(r*.52,r*.38)],skin,bone,16))
        rows=[]
        for t,rr in [(-.24,.91),(-.09,1.08),(0,1.11),(.15,1),(.36,.92),(.46,.97),(.56,.84),(.72,.80),(.78,.83),(.90,.76),(.96,.61),(1,.15)]:
            x=offset+spread*t
            y=-.002-.003*t-curl*t*t
            z=base+length*t
            rows.append([hand(x+r*rr*math.cos(k*math.tau/16),y+r*rr*.88*math.sin(k*math.tau/16),z) for k in range(16)])
        pieces.append(rings('Relaxed finger',rows,skin,bone))
        nail=[]
        for k in range(20):
            a=math.tau*k/20
            t=.852+.083*math.sin(a)
            dx=.59*r*math.cos(a)
            x=offset+spread*t+dx
            y=-.002-.003*t-curl*t*t+.88*r*.78*math.sqrt(max(.08,1-(dx/(r*.80))**2))
            nail.append(hand(x,y+.00045,base+length*t))
        nail_outlines.append(nail)
    pts=[hand(x,y,z) for x,y,z in [(-.012,-.008,.021),(-.021,-.012,.039),(-.038,-.015,.049),(-.048,-.019,.061),(-.055,-.027,.078),(-.055,-.034,.090),(-.053,-.035,.094)]]
    pieces.append(tube('Thenar and thumb',pts,[(.012,.010),(.025,.019),(.0185,.015),(.013,.012),(.011,.010),(.008,.008),(.003,.004)],skin,bone))
    palm=fuse(pieces,bone+'__Warm_skin',bone,.00165)
    def conform_nail(obj,outline,direction,title):
        tree=BVHTree.FromPolygons([v.co for v in obj.data.vertices],[p.vertices[:] for p in obj.data.polygons])
        center=sum(map(Vector,outline),Vector())/len(outline)
        pts=[]
        for p in [center]+[center.lerp(Vector(edge),r) for r in (.2,.4,.6,.8,1.) for edge in outline]:
            hit,*_=tree.ray_cast(p+.018*direction,-direction)
            pts.append((hit if hit is not None else p)+.00013*direction)
        n=len(outline)
        faces=[(0,k+1,(k+1)%n+1) for k in range(n)]
        faces.extend((1+j*n+k,1+j*n+(k+1)%n,1+(j+1)*n+(k+1)%n,1+(j+1)*n+k) for j in range(4) for k in range(n))
        mesh(title,pts,faces,nailmat.name,bone)
    dorsal=Vector((s*normal.x,normal.y,normal.z))
    for i,outline in enumerate(nail_outlines):conform_nail(palm,outline,dorsal,'Finger nail '+side+str(i))

    bone='foot_'+side
    for ob in list(rig.children):
        if ob.vertex_groups[0].name==bone:remove(ob)

    def foot(x,y,z):return (s*(.130+x),y,z)
    # Cross sections progress from the heel to the ball. First toe is medial.
    sections=[(.075,.012,.029,.063,0),(.065,.032,.020,.082,0),(.043,.040,.018,.104,0),
              (.010,.040,.020,.125,0),(-.020,.037,.024,.121,.003),(-.052,.039,.027,.097,.006),
              (-.083,.049,.022,.078,.005),(-.111,.054,.018,.065,.002),(-.132,.050,.018,.053,0),(-.144,.048,.018,.046,0),(-.152,.041,.018,.040,-.005),(-.157,.029,.018,.035,-.013)]
    def section(p):
        y,w,b,t,c=p
        return [foot(c+w*math.cos(k*math.tau/32),y+min(0,y+.105)*(-.28)*math.cos(k*math.tau/32),(b+t)/2+(t-b)/2*math.sin(k*math.tau/32)) for k in range(32)]
    pieces=[rings('Instep',list(map(section,sections)),skin,bone)]
    toes=[(-.041,.016,.194),(-.014,.0118,.188),(.008,.0103,.179),(.026,.0091,.169),(.042,.0079,.157)]
    for idx,(x,r,reach) in enumerate(toes):
        root=-.129+idx*.003
        rows=[]
        for t,fac in [(-.10,1.05),(0,1.09),(.19,1.04),(.46,.95),(.66,.93),(.82,.87),(.93,.77),(.979,.51),(1,.14)]:
            y=root+(-reach-root)*t
            rows.append([foot(x+r*fac*math.cos(k*math.tau/16),y,.019+r*.82*fac+r*.82*fac*math.sin(k*math.tau/16)+.008*max(0,1-t*2)) for k in range(16)])
        pieces.append(rings('Toe',rows,skin,bone))
    footmesh=fuse(pieces,bone+'__Warm_skin',bone,.00165)
    for i,(x,r,reach) in enumerate(toes):
        outline=[foot(x+.59*r*math.cos(a*math.tau/20),-reach+.008+.005*math.sin(a*math.tau/20),.038) for a in range(20)]
        conform_nail(footmesh,outline,Vector((0,0,1)),'Toe nail '+side+str(i))
    outline=[(.080,.012,0),(.073,.030,0),(.058,.043,0),(.025,.047,0),(-.018,.044,.002),(-.050,.044,.003),
             (-.088,.054,.002),(-.118,.060,0),(-.146,.061,-.001),(-.165,.055,-.006),(-.186,.043,-.015),(-.201,.025,-.029),(-.203,.012,-.034)]
    edge=[(c+w,y) for y,w,c in outline]+[(c-w,y) for y,w,c in reversed(outline)]
    for _ in range(2):
        edge=[(a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t) for a,b in zip(edge,edge[1:]+edge[:1]) for t in (.25,.75)]
    rows=[[foot(x*f*.99,y*.993,z) for x,y in edge] for z,f in [(0,.96),(.003,1),(.015,1),(.019,.965)]]
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
            center=Vector(foot(0,-.031,max(.043,z)))
            hit,*_=tree.ray_cast(center+.20*radial,-radial)
            p=(hit if hit is not None else center+.042*radial)+.002*radial
            p.z=z
            strip.append(p)
        rows.append(strip)
    ff=[(i*4+j,(i+1)*4+j,(i+1)*4+j+1,i*4+j+1) for i in range(40) for j in range(3)]
    sling=mesh('Heel sling '+side,[p for row in rows for p in row],ff,sole,bone)
    sling.modifiers.new('Leather thickness','SOLIDIFY').thickness=.0024


# Carry lacquer edges, lacing and fittings through the same radial deformation.
for ob in list(rig.children):
    if ob.name.startswith('chest__') and any(k in ob.name for k in ('lamellar','bronze','crimson')):
        def chest(p):
            x,y,z=p
            influence=clamp((1.46-z)/.06)
            theta=math.atan2(y/.145,x/.194)
            y*=1+influence*(.13+.15*math.cos(theta)**2)
            x*=1-influence*.027*math.cos(theta)**2
            return x,y,z
        shape(ob,chest)
    if ob.name.startswith('thigh_'):
        s=1 if '_L__' in ob.name else -1
        def trousers(p):
            x=p.x-s*.128
            a=math.atan2(p.y,x)
            fold=(.054*G(p.z-.60,.10)*math.cos(6*a+s*(p.z-.51)*6)
                  +.045*G(p.z-.49,.040)*math.cos((p.z-.49)*86+1.3*math.sin(a)))
            return .128*s+x*(1+fold),p.y*(1+fold),p.z+.006*G(p.z-.49,.043)*math.sin(2*a+.4)
        shape(ob,trousers)
    if ob.name.startswith('pelvis__') and any(k in ob.name for k in ('lamellar','bronze','crimson')):
        def skirt(p):
            x,y,z=p
            if not .674<z<.966 or (abs(x)<.08 and y<-.154):return p
            row=clamp((.943-z)/.235)
            rx=.195+.064*row
            ry=.150+.047*row
            a=math.atan2(y/ry,x/rx)
            # These are the existing eight tasset centre angles. Include only the shell, leaving the sword attachment intact.
            radius=math.hypot(x/rx,y/ry)
            if not .91<radius<1.10:return p
            centers=[v*math.pi for v in (0,.28,.50,.72,1,-.72,-.50,-.28)]
            d=min((math.atan2(math.sin(a-v),math.cos(a-v)) for v in centers),key=abs)
            new=a-.13*d
            return rx*radius*math.cos(new),ry*radius*math.sin(new),z
        shape(ob,skirt)
obi=D.objects['pelvis__Ox-blood_crimson_bindings']
island_filter(obi,lambda vs,ps:len(vs)>=160 and max(p.x for p in ps)>.17 and min(p.x for p in ps)<-.17 and min(p.z for p in ps)>.952)
for k in range(4):
    rows=[]
    for v,rad in [(0,0),(.07,.0038),(.26,.0041),(.70,.0026),(.94,.001),(1,-.0005),(1,-.004),(0,-.004)]:
        row=[]
        for i in range(72):
            a=math.tau*i/72
            z=.959+k*.0245+v*.035+.012*math.cos(a)*(-1 if k%2 else 1)+.004*math.sin(2*a+.7*k)
            fullness=.005*math.sin(math.pi*clamp((z-.958)/.114))
            row.append(((.187+fullness+rad)*math.cos(a),-.005+(.141+fullness+rad)*math.sin(a),z))
        rows.append(row)
    mesh('Woven sash wrap '+str(k+1),sum(rows,[]),[(j*72+i,j*72+(i+1)%72,((j+1)%8)*72+(i+1)%72,((j+1)%8)*72+i) for j in range(8) for i in range(72)],red,'pelvis')
for ob in rig.children:
    if ob.type=='MESH' and not ob.data.uv_layers and any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in ob.data.materials):
        uv=ob.data.uv_layers.new(name='UVMap')
        for loop in ob.data.loops:
            p=ob.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=(p.x*6+p.z,p.y*6+p.z)
bpy.context.view_layer.update()
# Workbench studio lighting and orthographic detail views show the actual surfaces.
def isolate(groups):
    for ob in rig.children:
        if ob.type=='MESH':ob.hide_render=not ob.vertex_groups[0].name.startswith(groups)
isolate(('hand_L','forearm_L'))
shot('hand_solid',(.427,-.026,.898),(.94,-.34,.16),.224,640,740)
isolate(('foot_L','shin_L'))
shot('foot_solid',(.132,-.059,.058),(.56,-.87,.52),.32,840,640)
isolate(('',))
shot('front_solid',(0,0,.93),(0,-1,0),1.96,680,1024)
# Reproduce material-preview lighting with Blender's bundled studio environment.
scene.render.engine='CYCLES'
scene.cycles.samples=22
for name,color in [('Face warm skin',(.42,.255,.182)),('Warm skin',(.42,.255,.182)),('Muted eye whites',(.58,.54,.50)),('Natural muted lips',(.32,.165,.135))]:
    material=D.materials[name]
    shader=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value=(*color,1)
    material.diffuse_color=(*color,1)
    if 'Subsurface Scale' in shader.inputs:
        shader.inputs['Subsurface Scale'].default_value=.0016
    shader.inputs['Roughness'].default_value=.58 if 'eye' not in name else .32
world=scene.world
world.use_nodes=True
background=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND')
env=world.node_tree.nodes.new('ShaderNodeTexEnvironment')
studio=Path(bpy.utils.system_resource('DATAFILES'))/'studiolights/world/studio.exr'
env.image=D.images.load(str(studio))
env.image.pack()
world.node_tree.links.new(env.outputs['Color'],background.inputs['Color'])
background.inputs['Strength'].default_value=.32
scene.render.film_transparent=False
# Uniform studio backdrop for camera rays, retaining the HDRI for material response.
output=next(n for n in world.node_tree.nodes if n.type=='OUTPUT_WORLD')
mix=world.node_tree.nodes.new('ShaderNodeMixShader')
flat=world.node_tree.nodes.new('ShaderNodeBackground')
flat.inputs[0].default_value=(.33,.29,.265,1)
lightpath=world.node_tree.nodes.new('ShaderNodeLightPath')
world.node_tree.links.new(lightpath.outputs['Is Camera Ray'],mix.inputs[0])
world.node_tree.links.new(background.outputs[0],mix.inputs[1])
world.node_tree.links.new(flat.outputs[0],mix.inputs[2])
world.node_tree.links.new(mix.outputs[0],output.inputs[0])
shot('face_material',(0,-.01,1.651),(.10,-1,.025),.41,760,880)
shot('front',(0,0,.93),(0,-1,0),1.96,680,1024)
shot('armor_three_quarter',(0,0,1.19),(.68,-1,.16),.74,780,700)
cam.location=(0,-4,.93)
cam.rotation_euler=(Vector((0,0,.93))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=1.96
scene.render.resolution_x,scene.render.resolution_y=680,1024
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.shading.type='MATERIAL'
        area.spaces.active.shading.studio_light='studio.exr'
        area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for ob in rig.children:
    if ob.type=='MESH':ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(out/'samurai_character.glb'),export_format='GLB',use_selection=True,export_animations=True,export_nla_strips=True,export_skins=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'samurai_character.blend'))
