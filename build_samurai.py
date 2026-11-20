import bpy
import math
import random
from mathutils import Vector, Euler
from pathlib import Path

random.seed(14)
OUT = Path(r'C:\TrainAi\Animated\public\models')
OUT.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for col in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions, bpy.data.lights, bpy.data.cameras, bpy.data.images):
    for item in list(col):
        col.remove(item)

def material(name, color, rough=.78, metal=0.0, grain=0, spec=.32, subsurf=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    if 'Metallic' in bs.inputs:
        bs.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in bs.inputs:
        bs.inputs['Specular IOR Level'].default_value = spec
    if subsurf > 0 and 'Subsurface Weight' in bs.inputs:
        bs.inputs['Subsurface Weight'].default_value = subsurf
    m.diffuse_color = (*color, 1)
    if grain:
        size = 64
        img = bpy.data.images.new(name + '_embedded_texture', width=size, height=size, alpha=True)
        px = []
        for j in range(size):
            for i in range(size):
                n = 1 + random.uniform(-grain, grain)
                if name in ('Indigo fabric', 'Charcoal trousers'):
                    n *= 1 + 0.028 * math.sin(i * 1.9) * math.cos(j * 0.7)
                elif name == 'Charcoal lacquered lamellar':
                    n *= 1 + 0.022 * math.sin(j * 3.1)
                px.extend([min(1, max(0, c * n)) for c in color] + [1])
        img.pixels[:] = px
        img.pack()
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = img
        m.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    return m

indigo     = material('Indigo fabric', (.055, .072, .135), rough=.85, grain=.08, spec=.18)
white_col  = material('White kimono collar', (.78, .76, .72), rough=.82, grain=.04, spec=.20)
trousers   = material('Charcoal trousers', (.095, .096, .108), rough=.88, grain=.08, spec=.16)
armor      = material('Charcoal lacquered lamellar', (.068, .070, .078), rough=.52, metal=.16, grain=.06, spec=.48)
armor_edge = material('Weathered bronze edges', (.38, .27, .15), rough=.44, metal=.76, grain=.05, spec=.58)
crimson    = material('Ox-blood crimson bindings', (.31, .062, .072), rough=.76, grain=.06, spec=.22)
red_dark   = material('Dark crimson cord', (.23, .042, .052), rough=.76, spec=.22)
skin       = material('Warm skin', (.40, .225, .145), rough=.64, spec=.32, subsurf=.15)
face_skin  = material('Face warm skin', (.40, .225, .145), rough=.60, spec=.34, subsurf=.18)
face_shad  = material('Face contour', (.37, .225, .165), rough=.70, spec=.24, subsurf=.12)
hair       = material('Black hair', (.014, .013, .016), rough=.62, grain=.10, spec=.22)
hair_high  = material('Hair strand variation', (.024, .021, .026), rough=.58, spec=.25)
eye_white  = material('Muted eye whites', (.78, .75, .73), rough=.35, spec=.45)
iris       = material('Deep brown irises', (.048, .026, .018), rough=.25, spec=.60)
lip        = material('Natural muted lips', (.42, .22, .20), rough=.60, spec=.34)
ribbon     = material('Muted red hair ribbon', (.30, .052, .062), rough=.74, spec=.24)
ivory      = material('Ivory grip diamonds', (.62, .57, .47), rough=.68, spec=.28)
steel      = material('Muted steel', (.45, .46, .49), rough=.32, metal=.86, spec=.65)
sole       = material('Straw soles', (.46, .37, .23), rough=.86, grain=.10, spec=.16)

rig = None
parts = []

def smooth(o):
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o

def finish(o, name, mat, bone=None, do_smooth=True):
    o.name = name
    if mat:
        o.data.materials.append(mat)
    if o.type == 'MESH':
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
        if do_smooth:
            smooth(o)
        uv = o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
        for poly in o.data.polygons:
            for li in poly.loop_indices:
                co = o.data.vertices[o.data.loops[li].vertex_index].co
                uv.data[li].uv = ((co.x * 2.5 + co.y) % 1, (co.z * 2.5) % 1)
        if bone:
            vg = o.vertex_groups.new(name=bone)
            vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
            mod = o.modifiers.new('Rigid bone skin', 'ARMATURE')
            mod.object = rig
            o.parent = rig
    parts.append(o)
    return o

def loft(name, rings, mat, bone, sides=24, closed_caps=True, rot=None, offset=(0,0,0)):
    verts = []
    ox, oy, oz = offset
    for r in rings:
        if len(r) == 4:
            z, rx, ry, cy = r
            cx = 0.0
        else:
            cx, cy, z, rx, ry = r[0], r[1], r[2], r[3], r[4]
        for i in range(sides):
            a = i * math.tau / sides
            v = Vector((cx + rx * math.cos(a), cy + ry * math.sin(a), z))
            if rot:
                v.rotate(Euler(rot))
            verts.append((v.x + ox, v.y + oy, v.z + oz))
    faces = []
    for j in range(len(rings) - 1):
        for i in range(sides):
            k = j * sides + i
            nxt = j * sides + (i + 1) % sides
            faces.append((k, nxt, nxt + sides, k + sides))
    if closed_caps:
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple((len(rings) - 1) * sides + i for i in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone, do_smooth=True)

def wrap_plate(name, z_top, z_bot, rx_top, ry_top, rx_bot, ry_bot, ang_start, ang_end, thick, mat, bone, na=14, nz=3, cx=0.0, cy=0.0):
    verts = []
    for side in (0, 1):
        dr = -thick * 0.5 if side == 0 else thick * 0.5
        for j in range(nz + 1):
            fz = j / nz
            z = z_top + (z_bot - z_top) * fz
            rx = rx_top + (rx_bot - rx_top) * fz + dr
            ry = ry_top + (ry_bot - ry_top) * fz + dr
            for i in range(na + 1):
                fa = i / na
                a = ang_start + (ang_end - ang_start) * fa
                verts.append((cx + rx * math.cos(a), cy + ry * math.sin(a), z))
    stride = (na + 1) * (nz + 1)
    faces = []
    for j in range(nz):
        for i in range(na):
            a = j * (na + 1) + i
            b = a + 1
            c = a + (na + 1) + 1
            d = a + (na + 1)
            faces.append((a, b, c, d))
            faces.append((a + stride, d + stride, c + stride, b + stride))
    for i in range(na):
        a, b = i, i + 1
        faces.append((a, a + stride, b + stride, b))
        a, b = nz * (na + 1) + i, nz * (na + 1) + i + 1
        faces.append((a, b, b + stride, a + stride))
    for j in range(nz):
        a, b = j * (na + 1), (j + 1) * (na + 1)
        faces.append((a, b, b + stride, a + stride))
        a, b = j * (na + 1) + na, (j + 1) * (na + 1) + na
        faces.append((a, a + stride, b + stride, b))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone, do_smooth=True)

def sode_tier_plate(name, p_start, p_end, row_idx, width_y, arch_y, thick, height_z, mat, bone, nu=8, nv=10):
    arm_dir = (p_end - p_start).normalized()
    sgn = 1.0 if p_end.x > 0 else -1.0
    out_dir = Vector((sgn * abs(arm_dir.z), 0, abs(arm_dir.x))).normalized()
    t = 0.04 + row_idx * 0.145
    center = p_start.lerp(p_end, t) + out_dir * (0.068 + row_idx * 0.005)
    verts = []
    for side in (0, 1):
        dn = -thick * 0.5 if side == 0 else thick * 0.5
        for j in range(nu + 1):
            fu = j / nu - 0.5
            for i in range(nv + 1):
                fv = i / nv - 0.5
                ang = fv * 2.45
                p = (center
                     + arm_dir * (fu * height_z)
                     + out_dir * (dn - arch_y * (1.0 - math.cos(ang)))
                     + Vector((0, width_y * math.sin(ang), 0)))
                verts.append(tuple(p))
    stride = (nu + 1) * (nv + 1)
    faces = []
    for j in range(nu):
        for i in range(nv):
            a = j * (nv + 1) + i
            b = a + 1
            c = a + (nv + 1) + 1
            d = a + (nv + 1)
            faces.append((a, b, c, d))
            faces.append((a + stride, d + stride, c + stride, b + stride))
    for i in range(nv):
        a, b = i, i + 1
        faces.append((a, a + stride, b + stride, b))
        a, b = nu * (nv + 1) + i, nu * (nv + 1) + i + 1
        faces.append((a, b, b + stride, a + stride))
    for j in range(nu):
        a, b = j * (nv + 1), (j + 1) * (nv + 1)
        faces.append((a, b, b + stride, a + stride))
        a, b = j * (nv + 1) + nv, (j + 1) * (nv + 1) + nv
        faces.append((a, a + stride, b + stride, b))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone, do_smooth=True), center, arm_dir, out_dir

def tube(name, points, radii, mat, bone, sides=10, closed=True):
    centers = [Vector(p) for p in points]
    verts = []
    is_per_point = isinstance(radii, list)
    for i, p in enumerate(centers):
        t = (centers[min(i + 1, len(centers) - 1)] - centers[max(i - 1, 0)]).normalized()
        if i == 0:
            up = Vector((0, 1, 0)) if abs(t.y) < .9 else Vector((1, 0, 0))
            u = t.cross(up).normalized()
        else:
            u = (u - t*u.dot(t)).normalized()
        v = t.cross(u).normalized()
        r = radii[i] if is_per_point else radii
        rx, ry = (r[0], r[1]) if isinstance(r, (list, tuple)) else (r, r)
        for k in range(sides):
            a = k * math.tau / sides
            verts.append(tuple(p + math.cos(a) * rx * u + math.sin(a) * ry * v))
    faces = []
    for j in range(len(points) - 1):
        for k in range(sides):
            q = j * sides + k
            n = j * sides + (k + 1) % sides
            faces.append((q, n, n + sides, q + sides))
    if closed:
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple((len(points) - 1) * sides + k for k in range(sides)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone, do_smooth=True)

def sphere(name, loc, scale, mat, bone, seg=16, rings=12, rot=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=loc)
    o = bpy.context.object
    o.scale = scale
    if rot:
        o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=bool(rot), scale=True)
    return finish(o, name, mat, bone, do_smooth=True)

def cyl(name, a, b, r1, r2, mat, bone, verts=12):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=max(d.length, 0.001), location=(a + b) * 0.5)
    o = bpy.context.object
    if d.length > 1e-5:
        o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, mat, bone, do_smooth=True)

def panel(name, points, depth, mat, bone):
    vs = [tuple(p) for p in points] + [(p[0], p[1] + depth, p[2]) for p in points]
    n = len(points)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, n * 2))]
    for i in range(n):
        faces.append((i, (i + 1) % n, (i + 1) % n + n, i + n))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vs, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bone, do_smooth=True)

# ==============================================================================
# 1. ARMATURE (7.75-head athletic samurai proportions, natural A-pose)
# ==============================================================================
arm = bpy.data.armatures.new('Samurai humanoid skeleton')
rig = bpy.data.objects.new('Samurai_Rig', arm)
bpy.context.collection.objects.link(rig)
rig.location = (0, 0, 0)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')

spec = [
    ('root',   (0, 0, 0),    (0, 0, .94),  None),
    ('pelvis', (0, 0, .94),  (0, 0, 1.07), 'root'),
    ('spine',  (0, 0, 1.07), (0, 0, 1.27), 'pelvis'),
    ('chest',  (0, 0, 1.27), (0, 0, 1.47), 'spine'),
    ('neck',   (0, 0, 1.47), (0, 0, 1.56), 'chest'),
    ('head',   (0, 0, 1.56), (0, 0, 1.79), 'neck'),
]
for side, sgn in [('L', 1), ('R', -1)]:
    spec += [
        ('upper_arm_' + side, (sgn * .19, 0, 1.42), (sgn * .31, .01, 1.19), 'chest'),
        ('forearm_' + side,   (sgn * .31, .01, 1.19), (sgn * .42, -.01, .97), 'upper_arm_' + side),
        ('hand_' + side,      (sgn * .42, -.01, .97), (sgn * .47, -.02, .85), 'forearm_' + side),
        ('thigh_' + side,     (sgn * .105, 0, .94), (sgn * .125, 0, .52), 'pelvis'),
        ('shin_' + side,      (sgn * .125, 0, .52), (sgn * .130, 0, .10), 'thigh_' + side),
        ('foot_' + side,      (sgn * .130, 0, .10), (sgn * .130, -.14, .035), 'shin_' + side),
    ]
for name, h, t, parent in spec:
    b = arm.edit_bones.new(name)
    b.head = h
    b.tail = t
    if parent:
        b.parent = arm.edit_bones[parent]
    if name != 'root':
        b.align_roll(Vector((0, 1, 0)))
bpy.ops.object.mode_set(mode='OBJECT')
rig.select_set(False)

# ==============================================================================
# 2. ANATOMICAL NECK, KIMONO UNDER-TORSO & CRISP CROSSED WHITE COLLAR
# ==============================================================================
loft('anatomical_neck', [
    (1.43, .085, .072, -.005),
    (1.47, .058, .054, -.010),
    (1.52, .052, .048, -.012),
    (1.57, .053, .049, -.014),
], skin, 'neck', sides=22)

loft('kimono_upper_torso', [
    (1.03, .162, .118, 0),
    (1.16, .172, .125, 0),
    (1.30, .188, .135, 0),
    (1.42, .182, .125, 0),
    (1.47, .115, .092, -.005),
    (1.485, .079, .062, .002),
], indigo, 'spine', sides=24)

for s in (-1, 1):
    y_bias = -0.004 if s == 1 else 0.002
    white_collar_pts = [
        (0.0,       .060, 1.505),
        (s * .062,  .025, 1.500),
        (s * .068, -.035, 1.482),
        (s * .042, -.092 + y_bias, 1.432),
        (0.0,      -.124 + y_bias, 1.380),
    ]
    tube(f'white_collar_band_{s}', white_collar_pts, [(.010, .022), (.011, .022), (.011, .022), (.010, .020), (.008, .016)], white_col, 'chest', sides=12)
    navy_collar_pts = [
        (0.0,       .072, 1.498),
        (s * .076,  .030, 1.492),
        (s * .082, -.038, 1.474),
        (s * .055, -.102 + y_bias, 1.422),
        (0.0,      -.134 + y_bias, 1.365),
    ]
    tube(f'navy_collar_band_{s}', navy_collar_pts, [(.012, .024), (.013, .024), (.013, .024), (.012, .022), (.010, .018)], indigo, 'chest', sides=12)

# ==============================================================================
# 3. TAPERED ATHLETIC CUIRASS (DO) WITH BRONZE TRIM & RED ODOSHI LACING
# ==============================================================================
cuirass_tiers = [
    (1.385, .193, .140),
    (1.326, .198, .149),
    (1.267, .193, .146),
    (1.208, .183, .137),
    (1.149, .172, .120),
    (1.090, .168, .118),
]
for r_idx, (zc, rx, ry) in enumerate(cuirass_tiers):
    zt, zb = zc + 0.034, zc - 0.032
    for fb_name, a0, a1, sy in [('front', -math.pi * 0.88, -math.pi * 0.12, -1), ('back', math.pi * 0.12, math.pi * 0.88, 1)]:
        wrap_plate(f'do_{fb_name}_{r_idx}', zt, zb, rx, ry, rx - .003, ry - .002, a0, a1, 0.015, armor, 'chest', na=16, nz=2)
        trim_pts = []
        for k in range(17):
            a = a0 + (a1 - a0) * (k / 16.0)
            trim_pts.append(((rx + .006) * math.cos(a), (ry + .006) * math.sin(a), zb + .002))
        tube(f'do_trim_{fb_name}_{r_idx}', trim_pts, .0036, armor_edge, 'chest', sides=8, closed=False)
        for k in range(1, 16, 2):
            a = a0 + (a1 - a0) * (k / 16.0)
            for da in (-0.018, 0.018):
                lx = (rx + .008) * math.cos(a + da)
                ly = (ry + .008) * math.sin(a + da)
                cyl(f'do_lace_{fb_name}_{r_idx}_{k}_{int(da*1000)}', (lx, ly, zc + .018), (lx, ly, zc - .018), .0030, .0030, crimson, 'chest', 6)
    if r_idx >= 1:
        for s_side, a0, a1 in [('L', -math.pi * 0.14, math.pi * 0.14), ('R', math.pi * 0.86, math.pi * 1.14)]:
            wrap_plate(f'do_side_{s_side}_{r_idx}', zt, zb, rx - .004, ry - .004, rx - .006, ry - .005, a0, a1, 0.013, armor, 'chest', na=8, nz=2)

for fb_name, a0, a1 in [('front', -math.pi * 0.76, -math.pi * 0.24), ('back', math.pi * 0.24, math.pi * 0.76)]:
    wrap_plate(f'do_top_board_{fb_name}', 1.430, 1.398, .192, .132, .198, .136, a0, a1, 0.017, armor, 'chest', na=12, nz=2)
    top_pts = [((.192 + .006) * math.cos(a0 + (a1 - a0) * k / 12.0), (.132 + .006) * math.sin(a0 + (a1 - a0) * k / 12.0), 1.430) for k in range(13)]
    tube(f'do_top_bronze_{fb_name}', top_pts, .0052, armor_edge, 'chest', sides=8, closed=False)

for s in (-1, 1):
    strap_pts = [
        (s * .108, -.120, 1.422),
        (s * .118, -.065, 1.468),
        (s * .122,  0.00, 1.484),
        (s * .118,  .065, 1.470),
        (s * .108,  .120, 1.425),
    ]
    tube(f'watagami_{s}', strap_pts, (.018, .008), armor, 'chest', sides=10)
    tube(f'watagami_edge_{s}', strap_pts, (.021, .004), armor_edge, 'chest', sides=8)
    for sy in (-1, 1):
        sphere(f'chest_ring_{s}_{sy}', (s * .108, sy * .136, 1.398), (.013, .006, .013), armor_edge, 'chest', 12, 8)
        sphere(f'chest_knot_{s}_{sy}', (s * .108, sy * .142, 1.390), (.011, .010, .011), crimson, 'chest', 10, 8)
        cyl(f'chest_tassel_1_{s}_{sy}', (s * .103, sy * .142, 1.385), (s * .098, sy * .145, 1.345), .004, .0025, crimson, 'chest', 8)
        cyl(f'chest_tassel_2_{s}_{sy}', (s * .113, sy * .142, 1.385), (s * .118, sy * .145, 1.345), .004, .0025, crimson, 'chest', 8)

# ==============================================================================
# 4. LAYERED SODE (SHOULDER GUARDS), KIMONO SLEEVES, KOTE BRACERS & HANDS
# ==============================================================================
for s in (-1, 1):
    u_bone = 'upper_arm_L' if s == 1 else 'upper_arm_R'
    f_bone = 'forearm_L' if s == 1 else 'forearm_R'
    h_bone = 'hand_L' if s == 1 else 'hand_R'

    p_sh = Vector((s * .19, 0.0, 1.42))
    p_el = Vector((s * .31, 0.01, 1.19))
    p_wr = Vector((s * .42, -0.01, 0.97))
    tube(f'kimono_shoulder_yoke_{s}',
         [(s*.105,0,1.435),(s*.148,0,1.430),(s*.183,0,1.420),(s*.213,0,1.403),(s*.232,0,1.386)],
         [(.034,.053),(.040,.061),(.049,.062),(.045,.060),(.035,.052)],indigo,u_bone,20)

    folds = [(0,.060),(.14,.060),(.35,.062),(.51,.067),(.59,.064),(.68,.076),(.735,.069),(.81,.081),(.86,.069),(.92,.071),(1.035,.056)]
    sleeve = tube(f'kimono_sleeve_{s}', [p_sh.lerp(p_el,t) for t,r in folds],
                  [(r, r*1.08) for t,r in folds], indigo, u_bone, sides=32)
    for vertex in sleeve.data.vertices:
        row, col = divmod(vertex.index,32)
        t = folds[row][0]
        axis_point = p_sh.lerp(p_el,t)
        vertex.co = axis_point + (vertex.co-axis_point) * (.80+.20*min(1,t**3))
        vertex.co.z += .010 * math.sin(col*math.tau/32+.6*row) * math.sin(math.pi*min(t,1))
        # The hidden armhole follows the outside of the breastplate.
        chest_edge = .212 * math.sqrt(max(0,1-(vertex.co.y/.154)**2))
        vertex.co.x = s*max(s*vertex.co.x,chest_edge)

    for row in range(5):
        _, center, arm_dir, out_dir = sode_tier_plate(
            f'sode_tier_{s}_{row}', p_sh, p_el, row,
            width_y=0.124 - row * 0.003,
            arch_y=0.074,
            thick=0.013,
            height_z=0.044,
            mat=armor,
            bone=u_bone,
            nu=4, nv=12
        )
        rim_pts = []
        w_y = 0.124 - row * 0.003
        for i in range(13):
            fv = i / 12.0 - 0.5
            ang = fv * 2.45
            p = (center
                 + arm_dir * 0.022
                 + out_dir * (0.007 - 0.074 * (1.0 - math.cos(ang)))
                 + Vector((0, w_y * math.sin(ang), 0)))
            rim_pts.append(tuple(p))
        tube(f'sode_rim_{s}_{row}', rim_pts, .0040, armor_edge, u_bone, sides=8, closed=False)
        for i in (2, 4, 6, 8, 10):
            fv = i / 12.0 - 0.5
            ang = fv * 2.45
            p_top = center - arm_dir * 0.015 + out_dir * (0.008 - 0.074 * (1.0 - math.cos(ang))) + Vector((0, w_y * math.sin(ang), 0))
            p_bot = center + arm_dir * 0.015 + out_dir * (0.008 - 0.074 * (1.0 - math.cos(ang))) + Vector((0, w_y * math.sin(ang), 0))
            cyl(f'sode_lace_{s}_{row}_{i}', p_top, p_bot, .0034, .0034, crimson, u_bone, 6)

    forearm_pts = [p_el.lerp(p_wr, f / 5.0) for f in range(6)]
    tube(f'forearm_sleeve_{s}', forearm_pts, [.055, .053, .049, .045, .040, .036], indigo, f_bone, sides=16)

    bracer_pts = [p_el.lerp(p_wr, 0.14 + 0.84 * (f / 5.0)) for f in range(6)]
    tube(f'kote_bracer_{s}', bracer_pts, [.057, .054, .050, .046, .042, .038], armor, f_bone, sides=16)
    f_dir = (p_wr - p_el).normalized()
    f_u = f_dir.cross(Vector((0, 1, 0))).normalized()
    f_v = f_dir.cross(f_u).normalized()
    for f_pos, r_add, mat_b, r_tube, tag in [
        (0.18, .0025, armor_edge, .0032, 'bronze1'),
        (0.34, .0035, crimson,    .0042, 'cord1'),
        (0.55, .0025, armor_edge, .0032, 'bronze2'),
        (0.74, .0035, crimson,    .0042, 'cord2'),
        (0.92, .0035, crimson,    .0045, 'cord3'),
    ]:
        pc = p_el.lerp(p_wr, f_pos)
        rad = (0.057 * (1 - f_pos) + 0.038 * f_pos) + r_add
        ring_pts = [tuple(pc + math.cos(k * math.tau / 14) * rad * f_u + math.sin(k * math.tau / 14) * rad * f_v) for k in range(15)]
        tube(f'kote_band_{s}_{tag}', ring_pts, r_tube, mat_b, f_bone, sides=8, closed=False)

    across = Vector((s*.55,.84,0)).normalized()
    down = Vector((s*.18,-.02,-1)).normalized()
    normal = across.cross(down).normalized()
    knuckle = p_wr + down*.077
    palm = tube(f'hand_palm_{s}', [p_wr, p_wr+down*.028, p_wr+down*.058,knuckle],
                [.021,.032,.034,.029],skin,h_bone,sides=20)
    for vertex in palm.data.vertices:
        delta = vertex.co-p_wr
        vertex.co -= normal*delta.dot(normal)*.47
    for digit,(offset,length) in enumerate([(-.023,.060),(-.0075,.065),(.008,.060),(.023,.048)]):
        base = knuckle+across*offset
        course = [base+down*(length*t)+Vector((-s*.021*t*t,.007*t*t,0))+across*(offset*.18*t)
                  for t in (0,.30,.62,.87,1)]
        tube(f'finger_{s}_{digit}',course,[.009,.0085,.0075,.0063,.0035],skin,h_bone,sides=10)
    base=p_wr+down*.032-across*.020
    tube(f'thumb_{s}',[base,base-across*.017+down*.014,base-across*.024+down*.033,base-across*.020+down*.047],
         [.011,.010,.008,.004],skin,h_bone,sides=10)

# ==============================================================================
# 5. DARK RED CLOTH WAIST SASH (OBI) & LAYERED TASSETS (KUSAZURI)
# ==============================================================================
loft('crimson_obi_sash', [
    (0.960, .182, .135, -.004),
    (0.988, .188, .142, -.005),
    (1.018, .190, .144, -.005),
    (1.046, .185, .138, -.004),
    (1.068, .176, .130, -.003),
], crimson, 'pelvis', sides=28)
for z_obi in (0.976, 1.002, 1.028, 1.052):
    obi_ring = [(0.191 * math.cos(k * math.tau / 24), -0.005 + 0.145 * math.sin(k * math.tau / 24), z_obi + 0.010 * math.sin(k * math.tau / 24 + z_obi*40)) for k in range(25)]
    tube(f'obi_fold_{int(z_obi*1000)}', obi_ring, (.010,.014), crimson, 'pelvis', sides=8, closed=False)

sphere('obi_front_knot', (-.022, -.152, 1.002), (.044, .030, .036), crimson, 'pelvis', 14, 10)
for offset in (-.014,0,.014):
    tube('obi_knot_pleat',[(-.05+offset,-.166,1.020),(-.029+offset,-.182,1.010),(-.012+offset,-.181,.992),(.001+offset,-.165,.981)],
         [.003,.006,.006,.003],crimson,'pelvis',sides=8)
for t_idx, (tx0, tx1, tz_end) in enumerate([(-.045, -.058, .58), (-.004, .018, .63)]):
    tail_pts = [
        (-.022 + t_idx * .016, -.155, .988),
        ((tx0 + tx1) * .5, -.184, .86),
        (tx0, -.211, .72),
        (tx1, -.212, tz_end),
    ]
    tube(f'obi_tail_{t_idx}', tail_pts, [(.024, .009), (.032, .009), (.035, .008), (.032, .006)], crimson, 'pelvis', sides=10)

tasset_z = [0.940, 0.882, 0.824, 0.766, 0.708]
panel_spans = [
    ('F_R', -math.pi * 0.82, -math.pi * 0.62),
    ('F_C', -math.pi * 0.60, -math.pi * 0.40),
    ('F_L', -math.pi * 0.38, -math.pi * 0.18),
    ('B_L',  math.pi * 0.18,  math.pi * 0.38),
    ('B_C',  math.pi * 0.40,  math.pi * 0.60),
    ('B_R',  math.pi * 0.62,  math.pi * 0.82),
    ('S_L', -math.pi * 0.15,  math.pi * 0.15),
    ('S_R',  math.pi * 0.85,  math.pi * 1.15),
]
for p_tag, a0, a1 in panel_spans:
    for r_idx, zc in enumerate(tasset_z):
        rx_t = 0.190 + r_idx * 0.015
        ry_t = 0.146 + r_idx * 0.011
        rx_b = rx_t + 0.010
        ry_b = ry_t + 0.008
        zt, zb = zc + 0.025, zc - 0.025
        wrap_plate(f'kusazuri_{p_tag}_{r_idx}', zt, zb, rx_t, ry_t, rx_b, ry_b, a0, a1, 0.012, armor, 'pelvis', na=8, nz=2)
        trim_pts = [((rx_b + .005) * math.cos(a0 + (a1 - a0) * k / 8.0), (ry_b + .005) * math.sin(a0 + (a1 - a0) * k / 8.0), zb + .002) for k in range(9)]
        tube(f'kusazuri_trim_{p_tag}_{r_idx}', trim_pts, .0034, armor_edge, 'pelvis', sides=6, closed=False)
        for frac in (0.22, 0.50, 0.78):
            a = a0 + (a1 - a0) * frac
            rm_x, rm_y = (rx_t + rx_b) * 0.5 + .007, (ry_t + ry_b) * 0.5 + .007
            cyl(f'kusazuri_lace_{p_tag}_{r_idx}_{int(frac*100)}',
                (rm_x * math.cos(a), rm_y * math.sin(a), zc + .015),
                (rm_x * math.cos(a), rm_y * math.sin(a), zc - .015),
                .0030, .0030, crimson, 'pelvis', 6)

# ==============================================================================
# 6. NATURAL PLEATED HAKAMA PANTS TUCKED INTO SHIN GUARDS + WARAJI SANDALS
# ==============================================================================
loft('hakama_hip_base', [
    (0.78, .178, .132, .004),
    (0.86, .172, .128, .003),
    (0.94, .165, .122, .002),
], trousers, 'pelvis', sides=24)

for s in (-1, 1):
    t_bone = 'thigh_L' if s == 1 else 'thigh_R'
    s_bone = 'shin_L' if s == 1 else 'shin_R'
    ft_bone = 'foot_L' if s == 1 else 'foot_R'

    def build_hakama_leg():
        z_rings = [
            (0.90, s * .082, .004, .079, .093, .004),
            (0.80, s * .087, .003, .082, .097, .008),
            (0.68, s * .110, .002, .090, .109, .012),
            (0.57, s * .134, .004, .130, .135, .013),
            (0.505, s * .128, .006, .115, .121, .014),
            (0.483, s * .130, .005, .124, .126, .013),
            (0.45, s * .130, .004, .095, .098, .006),
            (0.425, s * .130, .003, .064, .066, .002),
        ]
        sides = 48
        verts = []
        for z, cx, cy, rx, ry, amp in reversed(z_rings):
            for i in range(sides):
                a = i * math.tau / sides
                pleat = amp * (1.35*math.cos(6*a+s*(z-.50)*4) + .48*math.cos(9*a-s*z*6))
                verts.append((cx + (rx + pleat) * math.cos(a), cy + (ry + pleat) * math.sin(a), z + .018*math.sin(a*2+s*z*6)*math.exp(-((z-.50)/.07)**2)))
        faces = []
        for j in range(len(z_rings) - 1):
            for i in range(sides):
                k = j * sides + i
                nxt = j * sides + (i + 1) % sides
                faces.append((k, nxt, nxt + sides, k + sides))
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple((len(z_rings) - 1) * sides + i for i in range(sides)))
        mesh = bpy.data.meshes.new(f'hakama_leg_{s}')
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        o = bpy.data.objects.new(f'hakama_leg_{s}', mesh)
        bpy.context.collection.objects.link(o)
        return finish(o, f'hakama_leg_{s}', trousers, t_bone, do_smooth=True)

    build_hakama_leg()

    loft(f'suneate_greave_{s}', [
        (s * .130, .002, .105, .048, .052),
        (s * .130, .002, .195, .055, .059),
        (s * .130, .013, .315, .071, .079),
        (s * .130, .004, .430, .066, .070),
    ], armor, s_bone, sides=20)
    wrap_plate(f'tateage_knee_{s}', 0.475, 0.420, .068, .072, .066, .070, -math.pi * 0.80, -math.pi * 0.20, 0.010, armor, s_bone, na=8, nz=2, cx=s * .130, cy=.004)
    for ang in (-0.52, -0.18, 0.18, 0.52):
        rib_pts = [
            (s * .130 + .050 * math.sin(ang), .002 - .054 * math.cos(ang), .112),
            (s * .130 + .062 * math.sin(ang), .003 - .066 * math.cos(ang), .275),
            (s * .130 + .068 * math.sin(ang), .004 - .072 * math.cos(ang), .425),
        ]
        tube(f'suneate_rib_{s}_{int(ang*100)}', rib_pts, .0030, armor_edge, s_bone, sides=6)
    for z_tie in (.125, .260, .410):
        rt = .052 if z_tie < .15 else .066 if z_tie < .3 else .069
        tie_pts = [(s * .130 + rt * math.sin(k * math.tau / 16), .010 - (rt+.009) * math.cos(k * math.tau / 16), z_tie) for k in range(17)]
        tube(f'suneate_tie_{s}_{int(z_tie*1000)}', tie_pts, .0048, crimson, s_bone, sides=8, closed=False)
    for dx_l in (-.014, .014):
        cyl(f'suneate_knot_tail_{s}_{int(dx_l*1000)}', (s * .130 + dx_l, -.070, .400), (s * .130 + dx_l * 1.35, -.075, .345), .0038, .0025, crimson, s_bone, 6)

    loft(f'waraji_sole_{s}', [
        (s * .130, -.042, .000, .048, .108),
        (s * .130, -.042, .014, .050, .112),
        (s * .130, -.042, .022, .047, .106),
    ], sole, ft_bone, sides=20)
    loft(f'foot_top_{s}', [
        (s * .130, -.034, .022, .042, .094),
        (s * .130, -.020, .054, .040, .078),
        (s * .130, -.002, .092, .041, .048),
        (s * .130, .002, .125, .043, .047),
    ], skin, ft_bone, sides=18)
    sphere(f'heel_{s}',(s*.130,.017,.054),(.040,.046,.052),skin,ft_bone)
    for digit in range(5):
        x=s*(.100+digit*.014)
        sphere(f'toe_{s}_{digit}',(x,-.125+.005*digit,.030),(.011-.0008*digit,.022-.001*digit,.011-.0009*digit),skin,ft_bone,12,8)
    for side_s in (-1, 1):
        s_pts = [
            (s * .130 + side_s * .006, -.122, .022),
            (s * .130 + side_s * .024, -.075, .052),
            (s * .130 + side_s * .042, -.018, .028),
            (s * .130 + side_s * .040,  .042, .062),
            (s * .130,                  .052, .082),
        ]
        tube(f'waraji_strap_{s}_{side_s}', s_pts, .0050, sole, ft_bone, sides=8)
    ankle_tie = [(s * .130 + .043 * math.cos(k * math.tau / 14), -.002 + .049 * math.sin(k * math.tau / 14), .088) for k in range(15)]
    tube(f'waraji_ankle_cord_{s}', ankle_tie, .0045, sole, ft_bone, sides=8, closed=False)

# ==============================================================================
# 7. SHEATHED SWORD AT THE LEFT HIP
# ==============================================================================
for i, (hilt_len, scab_len, z_off, y_off, x_off) in enumerate([
    (0.185, 0.48, 0.0,    0.0,    0.0),

]):
    guard = Vector((0.222 + x_off, -0.068 + y_off, 1.032 + z_off))
    hilt_dir = Vector((-0.20, -0.44, 0.88)).normalized()
    scab_dir = Vector((0.25, 0.50, -0.83)).normalized()
    top = guard + hilt_dir * hilt_len
    tip = guard + scab_dir * scab_len

    hilt_pts = [guard.lerp(top, f / 6.0) for f in range(7)]
    tube(f'katana_{i}_hilt', hilt_pts, (.013, .018), armor, 'pelvis', sides=12)
    cyl(f'katana_{i}_fuchi', guard, guard + hilt_dir * .016, .019, .018, armor_edge, 'pelvis', 12)
    cyl(f'katana_{i}_kashira', top - hilt_dir * .015, top + hilt_dir * .005, .018, .017, armor_edge, 'pelvis', 12)
    for j in range(6):
        p = guard.lerp(top, (j + 1) / 7.0)
        sphere(f'katana_{i}_diamond_{j}', p + Vector((.011, -.005, 0)), (.0045, .008, .0055), ivory, 'pelvis', 8, 6)
        sphere(f'katana_{i}_diamond_in_{j}', p + Vector((-.011, .005, 0)), (.0045, .008, .0055), ivory, 'pelvis', 8, 6)
    cyl(f'katana_{i}_tsuba', guard - hilt_dir * .0045, guard + hilt_dir * .0045, .038, .038, armor_edge, 'pelvis', 18)
    scab_pts = [guard.lerp(tip, k / 8.0) + Vector((0, 0, -0.016 * math.sin((k / 8.0) * math.pi))) for k in range(9)]
    tube(f'katana_{i}_scabbard', scab_pts, [(.015, .020)] * 7 + [(.014, .018), (.012, .016)], armor, 'pelvis', sides=12)
    p_tip, p_pre = scab_pts[-1], scab_pts[-2]
    cyl(f'katana_{i}_kojiri', p_pre.lerp(p_tip, .65), p_tip, .017, .015, armor_edge, 'pelvis', 12)
    for f_band in (0.12, 0.28):
        pb = guard.lerp(tip, f_band)
        cyl(f'katana_{i}_band_{int(f_band*100)}', pb - scab_dir * .007, pb + scab_dir * .007, .022, .022, armor_edge, 'pelvis', 12)
    cord_pts = [
        (0.185, -0.050 + y_off, 1.005),
        tuple(guard.lerp(tip, 0.16) + Vector((.010, 0, 0))),
        (0.190, 0.025 + y_off, 0.968),
    ]
    tube(f'katana_{i}_sageo_cord', cord_pts, .0058, crimson, 'pelvis', sides=8)

# ==============================================================================
# 8. HIGH-RES ANATOMICAL HEAD SCULPT (SHARP EAST ASIAN FEATURES & SERIOUS FACE)
# ==============================================================================
def build_anatomical_head():
    z_profile = [
        (1.556, .022, .024, -.060),
        (1.564, .038, .042, -.048),
        (1.576, .053, .060, -.034),
        (1.590, .065, .072, -.022),
        (1.602, .071, .079, -.016),
        (1.612, .074, .082, -.014),
        (1.622, .076, .085, -.012),
        (1.634, .078, .088, -.010),
        (1.646, .080, .090, -.008),
        (1.658, .083, .092, -.006),
        (1.670, .086, .094, -.004),
        (1.682, .084, .095, -.002),
        (1.693, .084, .096,  .000),
        (1.705, .085, .097,  .002),
        (1.722, .084, .097,  .005),
        (1.742, .080, .094,  .009),
        (1.762, .072, .086,  .014),
        (1.778, .058, .072,  .018),
        (1.790, .034, .044,  .022),
    ]
    sides = 48
    verts = []
    for z, rx, ry, cy in z_profile:
        for i in range(sides):
            a = i * math.tau / sides
            ca, sa = math.cos(a), math.sin(a)
            front = max(0.0, -sa)
            x = rx * ca
            y = cy + ry * sa

            if 1.570 <= z <= 1.635:
                gonion = math.exp(-((abs(ca) - 0.76) ** 2) / 0.035) * max(0.0, -sa + 0.15)
                x *= 1.0 + 0.065 * gonion
                buccal = math.exp(-((abs(ca) - 0.55) ** 2) / 0.04) * math.exp(-((z - 1.612) ** 2) / 0.0005) * front
                x *= 1.0 - 0.035 * buccal
                y += 0.004 * buccal

            if 1.652 <= z <= 1.685:
                zygo = math.exp(-((abs(ca) - 0.58) ** 2) / 0.045) * front
                x *= 1.0 + 0.055 * zygo
                y -= 0.011 * zygo

            if 1.668 <= z <= 1.696 and front > 0.35:
                orb = math.exp(-((abs(x) - 0.036) ** 2) / 0.00038) * math.exp(-((z - 1.682) ** 2) / 0.00010)
                y += 0.0095 * orb

            if 1.690 <= z <= 1.712 and front > 0.45:
                brow = math.exp(-((abs(x) - 0.030) ** 2) / 0.0010) * math.exp(-((z - 1.701) ** 2) / 0.00009)
                y -= 0.0075 * brow

            if 1.632 <= z <= 1.696 and front > 0.80:
                w_sigma = 0.000075 if z > 1.660 else 0.000125
                nose_w = math.exp(-(x * x) / w_sigma)
                if z >= 1.682:
                    t_n = (1.696 - z) / 0.014
                    proj = 0.011 * max(0.0, min(1.0, t_n))
                elif z >= 1.646:
                    t_n = (1.682 - z) / 0.036
                    proj = 0.011 + 0.015 * t_n
                else:
                    t_n = (z - 1.632) / 0.014
                    proj = 0.026 * max(0.0, min(1.0, t_n))
                y -= proj * nose_w

            if 1.584 <= z <= 1.598 and front > 0.75:
                groove = math.exp(-(x * x) / 0.0006) * math.exp(-((z - 1.591) ** 2) / 0.00003)
                y += 0.0045 * groove

            verts.append((x, y, z))

    faces = []
    for j in range(len(z_profile) - 1):
        for i in range(sides):
            k = j * sides + i
            nxt = j * sides + (i + 1) % sides
            faces.append((k, nxt, nxt + sides, k + sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(z_profile) - 1) * sides + i for i in range(sides)))
    mesh = bpy.data.meshes.new('sculpted_head')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new('sculpted_head', mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, 'sculpted_head', face_skin, 'head', do_smooth=True)

build_anatomical_head()

for s in (-1, 1):
    sphere(f'nose_wing_{s}', (s * .0115, -.097, 1.641), (.0065, .0075, .0060), face_skin, 'head', 10, 8)
    sphere(f'nostril_{s}', (s * .0075, -.101, 1.636), (.0032, .0035, .0018), face_shad, 'head', 8, 6)

for s in (-1, 1):
    panel(f'almond_eye_{s}', [
        (s * .018, -.086, 1.681),
        (s * .033, -.089, 1.6845),
        (s * .050, -.086, 1.6845),
        (s * .061, -.079, 1.682),
        (s * .049, -.085, 1.678),
        (s * .032, -.088, 1.678),
    ], .004, eye_white, 'head')
    sphere(f'iris_{s}', (s * .038, -.0895, 1.6815), (.0062, .0028, .0055), iris, 'head', 14, 10)
    sphere(f'pupil_{s}', (s * .038, -.0912, 1.6815), (.0030, .0018, .0032), hair, 'head', 10, 6)
    tube(f'upper_lid_{s}', [
        (s * .016, -.088, 1.6815),
        (s * .033, -.0915, 1.6855),
        (s * .050, -.088, 1.6852),
        (s * .063, -.080, 1.682),
    ], .0020, hair, 'head', sides=8)
    tube(f'lower_lid_{s}', [
        (s * .019, -.0875, 1.678),
        (s * .039, -.0895, 1.6765),
        (s * .059, -.0815, 1.680),
    ], .0013, face_shad, 'head', sides=6)
    tube(f'serious_eyebrow_{s}', [
        (s * .012, -.098, 1.693),
        (s * .031, -.101, 1.699),
        (s * .052, -.093, 1.704),
        (s * .066, -.082, 1.702),
    ], [.0038, .0045, .0038, .0018], hair, 'head', sides=8)
    loft(f'ear_{s}', [
        (s * .081, -.002, 1.648, .0065, .011),
        (s * .086,  .002, 1.668, .0085, .015),
        (s * .084,  .004, 1.688, .0065, .013),
    ], face_skin, 'head', sides=10)

tube('upper_lip', [
    (-.025, -.086, 1.609),
    (-.014, -.094, 1.6125),
    (-.005, -.0965, 1.6135),
    ( 0.000, -.096, 1.6125),
    ( .005, -.0965, 1.6135),
    ( .014, -.094, 1.6125),
    ( .025, -.086, 1.609),
], [(.0018, .0016), (.0032, .0026), (.0038, .0030), (.0035, .0028), (.0038, .0030), (.0032, .0026), (.0018, .0016)], lip, 'head', sides=8)
tube('mouth_seam', [
    (-.026, -.086, 1.6085),
    (-.012, -.0955, 1.6095),
    ( 0.000, -.097, 1.609),
    ( .012, -.0955, 1.6095),
    ( .026, -.086, 1.6085),
], .0013, face_shad, 'head', sides=6)
tube('lower_lip', [
    (-.021, -.087, 1.605),
    (-.010, -.094, 1.6035),
    ( 0.000, -.0955, 1.603),
    ( .010, -.094, 1.6035),
    ( .021, -.087, 1.605),
], [(.0020, .0018), (.0038, .0032), (.0042, .0035), (.0038, .0032), (.0020, .0018)], lip, 'head', sides=8)

# ==============================================================================
# 9. CENTER-PARTED HAIR AND COMPACT TOPKNOT
# ==============================================================================
def build_hair_cap():
    z_rings = [
        (1.615, .068, .058, .036),
        (1.652, .084, .080, .022),
        (1.692, .090, .094, .012),
        (1.732, .091, .098, .008),
        (1.768, .082, .094, .010),
        (1.795, .056, .068, .018),
        (1.810, .026, .034, .026),
    ]
    sides = 36
    verts = []
    for z, rx, ry, cy in z_rings:
        for i in range(sides):
            a = i * math.tau / sides
            ca, sa = math.cos(a), math.sin(a)
            front = max(0.0, -sa)
            x = rx * ca
            y = cy + ry * sa
            if z < 1.750 and front > 0.25:
                recede = (1.750 - z) * 0.65 * (front - 0.25)
                y += recede
            groove = .0028 * math.cos(15*a + 18*(z-1.70))
            edge = max(0,1-(z-1.615)/.077)
            nape = edge * (.018*abs(ca) - .014*max(0,sa) + .005*math.cos(11*a))
            verts.append((x + groove * ca, y + groove * sa, z+nape))
    faces = []
    for j in range(len(z_rings) - 1):
        for i in range(sides):
            k = j * sides + i
            nxt = j * sides + (i + 1) % sides
            faces.append((k, nxt, nxt + sides, k + sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(z_rings) - 1) * sides + i for i in range(sides)))
    mesh = bpy.data.meshes.new('sculpted_hair_cap')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new('sculpted_hair_cap', mesh)
    bpy.context.collection.objects.link(o)
    return finish(o, 'sculpted_hair_cap', hair, 'head', do_smooth=True)

build_hair_cap()

for s in (-1, 1):
    for k in range(5):
        ang = 0.25 + (k / 4.0) * 1.15
        x0 = s * 0.078 * math.sin(ang)
        y0 = -0.078 * math.cos(ang) + 0.008
        z0 = 1.752 + 0.022 * math.cos(ang)
        xm = s * 0.084 * math.sin(ang * 0.85)
        ym = 0.020 - 0.032 * math.cos(ang)
        zm = 1.796 - 0.004 * k
        tube(f'crown_lock_{s}_{k}', [
            (x0, y0, z0),
            (xm, ym, zm),
            (s * .016, .082, 1.788),
        ], [(.008, .005), (.011, .007), (.007, .005)], hair if k % 2 == 0 else hair_high, 'head', sides=8)

    front_strand_1 = [
        (s * .010, -.072, 1.766),
        (s * .042, -.092, 1.745),
        (s * .068, -.088, 1.702),
        (s * .076, -.076, 1.655),
    ]
    tube(f'front_parted_lock_{s}', front_strand_1, [(.009, .0045), (.010, .005), (.007, .0038), (.0015, .0012)], hair, 'head', sides=8)

    front_strand_2 = [
        (s * .032, -.068, 1.768),
        (s * .066, -.084, 1.735),
        (s * .085, -.072, 1.680),
        (s * .086, -.058, 1.622),
        (s * .080, -.048, 1.585),
    ]
    tube(f'temple_framing_lock_{s}', front_strand_2, [(.010, .005), (.011, .0055), (.008, .0042), (.0045, .0025), (.0012, .0010)], hair_high, 'head', sides=8)

    side_strand_3 = [
        (s * .068, -.040, 1.745),
        (s * .089, -.042, 1.698),
        (s * .092, -.032, 1.642),
        (s * .087, -.024, 1.602),
    ]
    tube(f'sideburn_lock_{s}', side_strand_3, [(.009, .0045), (.008, .004), (.005, .0028), (.0012, .0010)], hair, 'head', sides=7)

    nape_wisp = [
        (s * .058, .042, 1.665),
        (s * .062, .048, 1.615),
        (s * .056, .045, 1.572),
    ]
    tube(f'nape_wisp_{s}', nape_wisp, [(.008, .004), (.006, .003), (.0015, .001)], hair, 'head', sides=7)

# Fold the gathered locks up into a short fan above the crown.
cyl('knot_binding',(0,.055,1.794),(0,.068,1.82),.034,.037,red_dark,'head',20)
sphere('knotted_hair',(0,.068,1.834),(.053,.045,.045),hair,'head',24,12)
for i in range(14):
    a = i*math.tau/14
    pts=[]
    for radius,height in [(.022,1.807),(.046,1.826),(.053,1.847),(.038,1.867),(.017,1.879)]:
        t=(height-1.807)/.072
        pts.append((radius*math.cos(a+.5*t),.064+radius*.84*math.sin(a+.5*t)+.024*t,
                    height+.011*math.sin(3*a)*t))
    tube(f'folded_knot_lock_{i}',pts,[.008,.014,.016,.011,.001],hair if i%4 else hair_high,'head',10)
for obj in parts:
    if obj.vertex_groups[0].name=='head':
        obj.location.z -= .032

# ==============================================================================
# 10. ANIMATIONS (Idle & Walk at 30 fps) + MESH GROUP OPTIMIZATION
# ==============================================================================
from mathutils.bvhtree import BVHTree
bpy.context.view_layer.update()
def surface(obj):
    vertices = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return BVHTree.FromPolygons(vertices, [p.vertices[:] for p in obj.data.polygons])

for shell_prefix, cloth_prefix in [('kusazuri_', 'hakama_leg_'), ('do_', 'kimono_sleeve_'), ('sode_tier_', 'kimono_sleeve_')]:
    limbs = [(o.name, surface(o)) for o in parts if o.name.startswith(cloth_prefix)]
    contacts = []
    for plate in parts:
        if plate.name.startswith(shell_prefix):
            shell = surface(plate)
            if any(shell.overlap(limb) for _,limb in limbs):
                contacts.append(plate.name)
    print('REST FIT', shell_prefix, len(contacts), contacts[:20])

for b in rig.pose.bones:
    b.rotation_mode = 'XYZ'

def reset_pose():
    for b in rig.pose.bones:
        b.rotation_euler = (0, 0, 0)
        b.location = (0, 0, 0)
        b.scale = (1, 1, 1)

def key_pose(frame):
    for b in rig.pose.bones:
        b.keyframe_insert('rotation_euler', frame=frame, group=b.name)
        if b.name == 'root':
            b.keyframe_insert('location', frame=frame, group=b.name)

reset_pose()
for f, phase in [(1, 0), (16, math.pi), (31, math.tau)]:
    rig.pose.bones['chest'].rotation_euler.x = .014 * math.sin(phase)
    rig.pose.bones['head'].rotation_euler.x = .012 * math.sin(phase + .5)
    rig.pose.bones['upper_arm_L'].rotation_euler.x = .018 * math.sin(phase)
    rig.pose.bones['upper_arm_R'].rotation_euler.x = -.018 * math.sin(phase)
    rig.pose.bones['root'].location.z = .006 * math.sin(phase)
    key_pose(f)
idle = rig.animation_data.action
idle.name = 'Idle'
rig.animation_data.action = None

reset_pose()
for f, phase in [(1, 0), (9, math.pi / 2), (17, math.pi), (25, 3 * math.pi / 2), (33, math.tau)]:
    s = math.sin(phase)
    rig.pose.bones['thigh_L'].rotation_euler.x = .36 * s
    rig.pose.bones['thigh_R'].rotation_euler.x = -.36 * s
    rig.pose.bones['shin_L'].rotation_euler.x = .22 * max(0, -s)
    rig.pose.bones['shin_R'].rotation_euler.x = .22 * max(0, s)
    rig.pose.bones['foot_L'].rotation_euler.x = -.12 * s
    rig.pose.bones['foot_R'].rotation_euler.x = .12 * s
    rig.pose.bones['upper_arm_L'].rotation_euler.x = -.25 * s
    rig.pose.bones['upper_arm_R'].rotation_euler.x = .25 * s
    rig.pose.bones['forearm_L'].rotation_euler.x = -.08
    rig.pose.bones['forearm_R'].rotation_euler.x = -.08
    rig.pose.bones['pelvis'].rotation_euler.z = .035 * math.cos(phase)
    rig.pose.bones['root'].location.z = .012 * (1 - math.cos(2 * phase))
    key_pose(f)
walk = rig.animation_data.action
walk.name = 'Walk'
rig.animation_data.action = None

for action in [idle, walk]:
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 1, action)
    strip.action_frame_start = 1
    strip.action_frame_end = 31 if action == idle else 33
    track.mute = True
reset_pose()

groups = {}
for o in parts:
    key = (o.vertex_groups[0].name, o.data.materials[0].name)
    groups.setdefault(key, []).append(o)

optimized = []
for (bone, mat_name), objects in groups.items():
    if len(objects) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
    objects[0].name = bone + '__' + mat_name.replace(' ', '_')
    optimized.append(objects[0])
parts = optimized

# ==============================================================================
# 11. STUDIO LIGHTING, ORTHOGRAPHIC CAMERA, CYCLES RENDER & GLB/BLEND EXPORT
# ==============================================================================
scene = bpy.context.scene
try:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 10
    if hasattr(scene.cycles, 'use_denoising'):
        scene.cycles.use_denoising = True
except Exception:
    scene.render.engine = 'BLENDER_EEVEE'

world = scene.world or bpy.data.worlds.new('Warm gray studio')
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (.44, .41, .39, 1)
bg.inputs['Strength'].default_value = 0.85

def point(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

cam_data = bpy.data.cameras.new('Preview camera')
cam = bpy.data.objects.new('Preview camera', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 1.98

for name, loc, power, size in [
    ('key',  (-2.2, -3.2, 2.8), 300, 3.2),
    ('fill', (2.4,  -2.4, 2.0), 180, 2.6),
    ('rim',  (0.8,   2.6, 2.7), 240, 2.4),
]:
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = power
    d.shape = 'DISK'
    d.size = size
    ob = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    point(ob, (0, 0, 1.0))

scene.frame_set(1)
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
w, h = 480, 736
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100

views = [
    ('front',         (0.0, -4.0, 0.95), (0.0, 0.0, 0.95)),
    ('side',          (4.0,  0.0, 0.95), (0.0, 0.0, 0.95)),
    ('back',          (0.0,  4.0, 0.95), (0.0, 0.0, 0.95)),
    ('three_quarter', (2.6, -3.4, 1.04), (0.0, 0.0, 0.95)),
]

rendered_paths = {}
for label, loc, tgt in views:
    cam.location = loc
    point(cam, tgt)
    fp = OUT / f'samurai_{label}.png'
    scene.render.filepath = str(fp)
    bpy.ops.render.render(write_still=True)
    rendered_paths[label] = fp

imgs = [bpy.data.images.load(str(rendered_paths[k])) for k in ('front', 'side', 'back')]
src_px = [list(im.pixels) for im in imgs]
sheet = bpy.data.images.new('TurnaroundSheet', width=w * 3, height=h, alpha=True)
out_px = [0.0] * (w * 3 * h * 4)
row_floats = w * 4
sheet_row_floats = w * 3 * 4
for y in range(h):
    for idx in range(3):
        s_start = y * row_floats
        d_start = y * sheet_row_floats + idx * row_floats
        out_px[d_start:d_start + row_floats] = src_px[idx][s_start:s_start + row_floats]
sheet.pixels[:] = out_px
sheet.filepath_raw = str(OUT / 'samurai_turnaround_cycles.png')
sheet.file_format = 'PNG'
sheet.save()

for im in imgs + [sheet]:
    bpy.data.images.remove(im)

studio_engine = scene.render.engine
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'SINGLE'
shading.single_color = (.61,.57,.52)
shading.show_specular_highlight = False
shading.show_shadows = True
shading.show_cavity = True
shading.cavity_type = 'WORLD'
import numpy as np
solid_views = []
for label, loc, target in views[:3]:
    cam.location = loc
    point(cam,target)
    scene.render.filepath = str(OUT / ('samurai_solid_' + label + '.png'))
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(scene.render.filepath)
    raw = np.empty(w*h*4, dtype=np.float32)
    im.pixels.foreach_get(raw)
    solid_views.append(raw.reshape(h,w,4))
    bpy.data.images.remove(im)
sheet = bpy.data.images.new('Solid turnaround',width=3*w,height=h)
sheet.pixels.foreach_set(np.concatenate(solid_views,axis=1).ravel())
sheet.filepath_raw = str(OUT/'samurai_solid_turnaround.png')
sheet.file_format = 'PNG'
sheet.save()
bpy.data.images.remove(sheet)
scene.render.engine = studio_engine
cam.location = views[0][1]
point(cam,views[0][2])
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = OUT / 'samurai_character.glb'
bpy.ops.export_scene.gltf(
    filepath=str(glb),
    export_format='GLB',
    use_selection=True,
    export_apply=False,
    export_animations=True,
    export_nla_strips=True,
    export_skins=True,
    export_materials='EXPORT',
)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'samurai_character.blend'))
print('BUILT', len(parts), 'meshes', sum(len(o.data.vertices) for o in parts), 'verts', glb.stat().st_size, 'bytes')

