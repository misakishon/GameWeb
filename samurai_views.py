import bpy
from mathutils.bvhtree import BVHTree
from mathutils import Vector
from pathlib import Path
from collections import Counter
scene=bpy.context.scene
root=Path(r'C:/TrainAi/Animated/public/models/three_pass')
root.mkdir(exist_ok=True)
rig=next(o for o in scene.objects if o.type=='ARMATURE')
scene.frame_set(1)
cam=scene.camera
def pts(o):return [o.matrix_world@v.co for v in o.data.vertices]
def tree(o):return BVHTree.FromPolygons(pts(o),[f.vertices[:] for f in o.data.polygons])
def diagnose(tag):
    head=bpy.data.objects['head__Face_warm_skin']
    surf=tree(head)
    print('OBJECTS',[(o.name,len(o.data.vertices)) for o in rig.children if o.type=='MESH' and any(k in o.name for k in ('Indigo','lid','Eye','Charcoal_trousers'))])
    for sign in (-1,1):
        lid=bpy.data.objects['Lower lid '+str(sign)]
        co=pts(lid)
        signatures=Counter(tuple(sorted(tuple(round(k,6) for k in co[i]) for i in p.vertices)) for p in lid.data.polygons)
        forward=sum((lid.matrix_world.to_3x3()@p.normal).y<0 for p in lid.data.polygons)
        zone=[f for f in head.data.polygons if .017<sign*(head.matrix_world@f.center).x<.066 and 1.598<(head.matrix_world@f.center).z<1.632 and (head.matrix_world@f.center).y<-.055]
        folded=sum((head.matrix_world.to_3x3()@p.normal).y>=0 for p in zone)
        print('LID',sign,'front normals',forward,'of',len(lid.data.polygons),'duplicate polygons',sum(n-1 for n in signatures.values()),'lid/face crossings',len(surf.overlap(tree(lid))),'cheek outward normals',len(zone)-folded,'of',len(zone))
def shot(tag,tgt,direction,scale,w,h,hide=()):
    snapshot=[(o,o.hide_render) for o in rig.children]
    for o,state in snapshot:o.hide_render=state or any(o.name.startswith(p) for p in hide)
    scene.render.engine='BLENDER_WORKBENCH'
    sh=scene.display.shading
    sh.light='STUDIO'; sh.studio_light='paint.sl';sh.color_type='SINGLE';sh.single_color=(.66,.63,.60)
    sh.show_shadows=False;sh.show_specular_highlight=False;sh.show_cavity=True;sh.cavity_type='WORLD';sh.cavity_ridge_factor=.6;sh.cavity_valley_factor=.65
    sh.background_type='WORLD';scene.world.color=(.15,.15,.15)
    cam.location=Vector(tgt)+Vector(direction).normalized()*4
    cam.rotation_euler=(Vector(tgt)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=scale
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
    scene.render.filepath=str(root/(tag+'.png'));bpy.ops.render.render(write_still=True)
    for o,state in snapshot:o.hide_render=state
hair_hide=('head__Black_hair','head__Hair_strand_variation','head__Dark_crimson_cord')
def views(stage):
    shot(stage+'_cheek',(0,-.035,1.625),(0,-1,0),.276,514,540,hair_hide)
    shot(stage+'_profile',(0,-.005,1.65),(1,0,0),.405,514,540)
    hiden=tuple(o.name for o in rig.children if o.type=='MESH' and o.vertex_groups[0].name not in ('forearm_L','hand_L'))
    for label,angle in [('dorsal',(.84,-.54,.08)),('edge',(.46,.89,.04)),('palm',(-.85,.52,-.05))]:
        shot(stage+'_'+label,(.429,-.019,.897),angle,.226,426,490,hiden)
    clothes=tuple(o.name for o in rig.children if o.name.startswith(('chest__','upper_arm','forearm')) and 'Indigo' not in o.name)
    shot(stage+'_ribs',(0,0,1.285),(.60,-1,.08),.94,640,570,clothes)
    limbs=tuple(o.name for o in rig.children if o.vertex_groups[0].name.startswith(('upper_arm','forearm','hand')))
    shot(stage+'_rib_side',(0,0,1.285),(1,0,0),.65,510,540,clothes+limbs)
    shot(stage+'_full',(0,0,.93),(.18,-1,.01),1.96,570,960)
if __name__=='__main__':
    diagnose('before')
    views('before')
