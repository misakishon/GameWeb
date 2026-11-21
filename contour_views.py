"""Matched clay inspection cameras for the rigged character, plus assembly of labeled pairs."""
import bpy
from mathutils import Vector
from pathlib import Path
S=bpy.context.scene
R=next(o for o in S.objects if o.type=='ARMATURE')
O=Path(__file__).resolve().parent/'public'/'models'
P=O/'contour_review'
P.mkdir(exist_ok=True)
C=S.camera
def group(o):return o.vertex_groups[0].name if o.vertex_groups else ''
def shoot(stage,name,target,angle,scale,w,h,kind='all'):
    hidden=[(o,o.hide_render) for o in R.children]
    mask=None
    if kind=='rib_side':
        shirt=bpy.data.objects['spine__Indigo_fabric']
        mask=shirt.modifiers.new('Inspection only - near sleeve','MASK')
        mask.vertex_group='upper_arm_L';mask.invert_vertex_group=True;mask.threshold=.35
    try:
        for o,was in hidden:
            g=group(o)
            off=(kind=='hand' and g not in ('hand_L','forearm_L')) or (kind=='foot' and g not in ('foot_L','shin_L'))
            if kind.startswith('rib'):
                off=off or o.name.startswith(('chest__','upper_arm_','forearm_')) and 'Indigo' not in o.name
            if kind=='rib_side':off=off or g in ('upper_arm_L','forearm_L','hand_L')
            o.hide_render=was or off
        C.location=Vector(target)+Vector(angle).normalized()*4
        C.rotation_euler=(Vector(target)-C.location).to_track_quat('-Z','Y').to_euler()
        C.data.type='ORTHO';C.data.ortho_scale=scale
        S.render.engine='BLENDER_WORKBENCH'
        sh=S.display.shading
        sh.light='STUDIO';sh.studio_light='studio.sl';sh.color_type='SINGLE';sh.single_color=(.61,.55,.50)
        sh.show_shadows=True;sh.shadow_intensity=.22;sh.show_specular_highlight=True
        sh.show_cavity=True;sh.cavity_type='WORLD';sh.cavity_ridge_factor=.55;sh.cavity_valley_factor=.55
        sh.background_type='WORLD';S.world.color=(.16,.15,.145)
        S.render.resolution_x=w;S.render.resolution_y=h;S.render.resolution_percentage=100
        S.render.filepath=str(P/(stage+'_'+name+'.png'));bpy.ops.render.render(write_still=True)
    finally:
        if mask:shirt.modifiers.remove(mask)
        for o,was in hidden:o.hide_render=was

def inspect(stage):
    shoot(stage,'profile',(0,-.014,1.645),(1,0,0),.419,540,600)
    shoot(stage,'face',(0,-.014,1.645),(0,-1,0),.419,540,600)
    for label,d in [('palm',(-.85,.52,-.06)),('back',(.88,-.47,.08)),('edge',(.47,.88,.04))]:
        shoot(stage,label,(.428,-.020,.897),d,.236,420,490,'hand')
    shoot(stage,'rib_side',(0,0,1.25),(1,0,0),.71,500,600,'rib_side')
    shoot(stage,'rib_front',(0,0,1.25),(.19,-1,.03),.99,650,575,'rib_front')
    shoot(stage,'foot',(.13,-.055,.066),(.55,-1,.41),.335,610,440,'foot')
    shoot(stage,'full',(0,0,.93),(.06,-1,.01),1.985,520,920)
if __name__=='__main__':inspect('before')
