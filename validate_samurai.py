import bpy
from mathutils import Vector
from pathlib import Path

path=Path(r'C:\TrainAi\Animated\public\models\samurai_character.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(path))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
coords=[o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
mins=[min(v[i] for v in coords) for i in range(3)]
maxs=[max(v[i] for v in coords) for i in range(3)]
actions=[a.name for a in bpy.data.actions]
print('VALIDATION',{'meshes':len(meshes),'rigs':len(rigs),'bones':len(rigs[0].data.bones) if rigs else 0,'actions':actions,'min_xyz':tuple(round(x,4) for x in mins),'max_xyz':tuple(round(x,4) for x in maxs),'rig_origin':tuple(round(x,4) for x in rigs[0].matrix_world.translation) if rigs else None})
print('MESH_NAMES',[(o.name,tuple(round(v,2) for v in o.dimensions)) for o in meshes if max(o.dimensions)>1])
assert rigs and len(meshes)>=50
mesh_names=[o.name for o in meshes]
for region in ('pelvis','chest','upper_arm_L','upper_arm_R','thigh_L','thigh_R','shin_L','shin_R','hand_L','hand_R','head'):
    assert any(region in name for name in mesh_names),region
assert len(rigs[0].data.bones)>=18
assert any('Idle' in a for a in actions) and any('Walk' in a for a in actions)
assert 1.7 < maxs[2]-mins[2] < 2.1
assert abs(mins[2]) < .0001, 'Sandal soles must meet the ground plane'
rig=rigs[0]
walk=next(a for a in bpy.data.actions if 'Walk' in a.name)
rig.animation_data_create()
rig.animation_data.action=walk
if walk.slots:
    rig.animation_data.action_slot=walk.slots[0]
samples=[]
for frame in (1,9,17,25):
    bpy.context.scene.frame_set(frame)
    samples.append(tuple(round(v,4) for v in rig.pose.bones['thigh_L'].rotation_quaternion))
print('WALK_THIGH_SAMPLES',rig.pose.bones['thigh_L'].rotation_mode,samples)
assert max(v[1] for v in samples)-min(v[1] for v in samples)>.2
