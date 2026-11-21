"""Proportion pass + regroom for the samurai head.

Base unit: total head height H = 0.23 m (chin -> top of skull).
Stage 'warp'  : one continuous spatial warp applied to the face mesh and every facial
                feature object (eyes, lids, lips, brows, lashes) so nothing detaches,
                plus dedicated ear and neck transforms.
Stage 'groom' : deletes the old hair cap / tube strands and grows a new 3-layer groom
                (scalp emitter + base groom into a crown topknot, nape baby hairs,
                framing wisps) from the warped scalp.
Stage 'report': measures every landmark ratio from the final meshes.
Stage 'save'  : saves the .blend and exports the GLB like the rest of the pipeline.
"""
import bpy, bmesh, math, random, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from pathlib import Path

OUT = Path(r'C:/TrainAi/Animated/public/models')
H = 0.23
CHIN = 1.532
TOP = CHIN + H                 # 1.762
EYE_Z = CHIN + 0.5 * H         # 1.647
HAIRLINE_Z = TOP - 0.15 * H    # 1.7275
NOSE_Z = 1.602                 # nose base (lower third lengthened slightly)
MOUTH_Z = 1.5787               # stomion, 1/3 of the way from nose base to chin
CHEEK_W = 0.70 * H             # 0.161
JAW_W = 0.78 * CHEEK_W         # 0.1256
NECK_W = 0.82 * JAW_W          # 0.103
BUN_D = 0.26 * H               # shell diameter; coil ridges bring the outer size to ~0.28-0.29 H

FACE = 'head__Face_warm_skin'
NECK = 'neck__Warm_skin'
OLD_HAIR = ('Fine_hair_dark', 'head__Hair_strand_variation', 'head__Black_hair')

# Measured on the original mesh (rest pose, metres)
ORIG = dict(chin=1.532, mouth=1.5745, nose=1.594, eye=1.6505, top=1.772,
            eye_cx=0.0412, eye_cy=-0.100, eye_w=0.044)


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def pchip(xs, ys):
    xs = np.asarray(xs, float); ys = np.asarray(ys, float)
    h = np.diff(xs); d = np.diff(ys) / h
    m = np.zeros_like(ys); m[0] = d[0]; m[-1] = d[-1]
    for k in range(1, len(xs) - 1):
        if d[k - 1] * d[k] <= 0:
            m[k] = 0.0
        else:
            w1 = 2 * h[k] + h[k - 1]; w2 = h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

    def f(x):
        x = np.asarray(x, float)
        out = np.empty_like(x)
        lo = x < xs[0]; hi = x > xs[-1]; mid = ~(lo | hi)
        out[lo] = ys[0] + m[0] * (x[lo] - xs[0])
        out[hi] = ys[-1] + m[-1] * (x[hi] - xs[-1])
        xm = x[mid]
        i = np.clip(np.searchsorted(xs, xm) - 1, 0, len(xs) - 2)
        t = (xm - xs[i]) / h[i]
        t2 = t * t; t3 = t2 * t
        out[mid] = ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                    + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
        return out
    return f


def get_co(o):
    a = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def set_co(o, a):
    o.data.vertices.foreach_set('co', np.ascontiguousarray(a, dtype=np.float64).ravel())
    o.data.update()


def islands(o):
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    seen = np.zeros(len(bm.verts), bool); out = []
    for v in bm.verts:
        if seen[v.index]:
            continue
        st = [v]; seen[v.index] = True; comp = []
        while st:
            a = st.pop(); comp.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if not seen[b.index]:
                    seen[b.index] = True; st.append(b)
        out.append(np.array(comp))
    bm.free()
    return sorted(out, key=len, reverse=True)


def head_feature_objects(rig):
    objs = []
    for o in rig.children:
        if o.type != 'MESH' or o.name in OLD_HAIR or o.name == NECK:
            continue
        if [vg.name for vg in o.vertex_groups] != ['head']:
            continue
        if o.name.startswith(('Groom_', 'Scalp_emitter', 'Topknot_', 'Hair_tie')):
            continue
        objs.append(o)
    return objs


# ----------------------------------------------------------------------------- warp
class Warp:
    """Composite field: F = G o E (eye shrink first, then global head reshaping)."""

    def __init__(self, face_co, ear_idx, edges):
        main = np.ones(len(face_co), bool); main[np.concatenate(ear_idx)] = False
        self.main_co = face_co[main]
        edges = edges[main[edges[:, 0]] & main[edges[:, 1]]]
        ea, eb = face_co[edges[:, 0]], face_co[edges[:, 1]]
        # vertical landmark remap
        self.gz = pchip([1.40, 1.50, ORIG['chin'], ORIG['mouth'], ORIG['nose'], ORIG['eye'], ORIG['top'], 1.86],
                        [1.40, 1.50, CHIN, MOUTH_Z, NOSE_Z, EYE_Z, TOP, 1.85])
        dense = np.linspace(1.35, 1.90, 4000)
        self.gz_inv = lambda z: np.interp(z, self.gz(dense), dense)
        # current half-width profile of the skull (ears excluded)
        # exact cross-sections: intersect every edge with the plane z
        zs = np.arange(1.478, 1.774, 0.002); hws = []
        for z in zs:
            m = (ea[:, 2] - z) * (eb[:, 2] - z) <= 0
            dz = eb[m, 2] - ea[m, 2]
            t = np.where(np.abs(dz) > 1e-12, (z - ea[m, 2]) / np.where(np.abs(dz) > 1e-12, dz, 1), 0.5)
            xs = ea[m, 0] + t * (eb[m, 0] - ea[m, 0])
            hws.append(np.abs(xs).max() if len(xs) else 0.0)
        hws = np.convolve(np.pad(hws, 1, mode='edge'), np.ones(3) / 3, mode='valid')
        self.zs, self.hws = zs, np.maximum(hws, 0.004)
        # target full widths at final heights (front-view silhouette)
        tz = [CHIN, 1.540, 1.550, 1.565, MOUTH_Z, 1.592, 1.605, 1.618, 1.630, 1.640, 1.652, 1.665, 1.685, 1.700]
        tw = [0.094, 0.103, 0.113, 0.1225, JAW_W, 0.1275, 0.134, 0.150, CHEEK_W, CHEEK_W, 0.1595, 0.1585, 0.161, 0.160]
        zo = self.gz_inv(np.array(tz))
        sk = np.array(tw) / (2 * self.hw(zo))
        self.s_key = pchip(zo, sk); self.s_lo = (zo[0], sk[0]); self.s_hi = (zo[-1], sk[-1])
        self.tz, self.tw = tz, tw
        self.sE, self.cxn = 0.80, 0.034

    def hw(self, z):
        return np.interp(z, self.zs, self.hws)

    def s(self, z):
        z = np.asarray(z, float)
        out = self.s_key(np.clip(z, self.s_lo[0], self.s_hi[0]))
        low = z < self.s_lo[0]
        out[low] = 1 + (self.s_lo[1] - 1) * smoothstep(1.50, self.s_lo[0], z[low])
        out[z > self.s_hi[0]] = self.s_hi[1]
        return out

    def E(self, P, sE=None, cxn=None):
        sE = self.sE if sE is None else sE; cxn = self.cxn if cxn is None else cxn
        Rc, R = 0.0245, 0.046
        D = np.zeros_like(P)
        for sg in (-1.0, 1.0):
            c = np.array([sg * ORIG['eye_cx'], ORIG['eye_cy'], ORIG['eye']])
            cn = np.array([sg * cxn, ORIG['eye_cy'], ORIG['eye']])
            d = P - c
            r = np.sqrt(d[:, 0] ** 2 + (0.7 * d[:, 1]) ** 2 + d[:, 2] ** 2)
            w = 1 - smoothstep(Rc, R, r)
            D += w[:, None] * ((cn - c)[None, :] + (sE - 1) * d)
        return P + D

    def G(self, P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        s = self.s(z); hw = self.hw(z)
        # jaw widening (s>1) only on the mandible, never on the nape / neck junction behind it
        s = np.where(s > 1, 1 + (s - 1) * (1 - smoothstep(-0.005, 0.03, y)), s)
        u = np.clip(np.abs(x) / hw, 0, 1)
        b = smoothstep(1.68, 1.72, z)
        shift = (s - 1) * ((1 - b) * hw * u * u + b * np.abs(x))
        x2 = np.sign(x) * (np.abs(x) + shift)
        k, y0 = 0.10, 0.06       # shorten the long back of the skull slightly (brachycephalic)
        yp = np.where(y <= 0, y, np.where(y < y0, y - k * y * y / (2 * y0), y - k * (y - y0 / 2)))
        y2 = y + smoothstep(1.53, 1.58, z) * (yp - y)
        return np.stack([x2, y2, self.gz(z)], 1)

    def F(self, P):
        Q = self.G(self.E(P))
        # brow lift: re-open the brow -> eye spacing the eye shrink pulled down (equalises thirds)
        env = smoothstep(-0.04, -0.07, Q[:, 1]) * (1 - smoothstep(0.065, 0.085, np.abs(Q[:, 0])))
        Q[:, 2] += 0.0026 * np.exp(-((Q[:, 2] - 1.6635) / 0.008) ** 2) * env
        return Q

    def solve_eyes(self, eye_white_co):
        """Eye width = face width at eye line / 5; centres one eye-width apart."""
        W = 2 * self.hw(np.array([ORIG['eye']]))[0] * self.s(np.array([ORIG['eye']]))[0]
        e = W / 5
        right = eye_white_co[eye_white_co[:, 0] > 0]
        for _ in range(6):
            q = self.F(right)
            w = q[:, 0].max() - q[:, 0].min(); cx = 0.5 * (q[:, 0].max() + q[:, 0].min())
            self.sE *= e / w
            self.cxn += (e - cx) / 0.9
        q = self.F(right)
        return W, e, q[:, 0].max() - q[:, 0].min(), 0.5 * (q[:, 0].max() + q[:, 0].min())


def stage_warp():
    rig = bpy.data.objects['Samurai_Rig']
    face = bpy.data.objects[FACE]
    if face.get('proportion_H23'):
        print('warp already applied; skipping'); return
    backup = OUT / 'samurai_character_pre_proportion.blend'
    if not backup.exists():
        bpy.ops.wm.save_as_mainfile(filepath=str(backup), copy=True)
    fco = get_co(face)
    isl = islands(face)
    ear_idx = [i for i in isl[1:] if len(i) > 1000 and np.abs(fco[i, 0]).min() > 0.06]
    assert len(ear_idx) == 2, [len(i) for i in isl]
    ed = np.empty(len(face.data.edges) * 2, np.int64); face.data.edges.foreach_get('vertices', ed)
    W = Warp(fco, ear_idx, ed.reshape(-1, 2))
    ew = np.concatenate([get_co(bpy.data.objects['Eye white 1']), get_co(bpy.data.objects['Eye white -1'])])
    Wf, e, wf, cxf = W.solve_eyes(ew)
    print(f'eye solve: face W at eye line {Wf:.4f}, target eye width {e:.4f}, got width {wf:.4f} centre {cxf:.4f}, sE {W.sE:.3f}')
    # global field on every head feature object
    for o in head_feature_objects(rig):
        P = get_co(o)
        if o == face:
            ears = np.concatenate(ear_idx)
            keep = P[ears].copy()
            P = W.F(P)
            P[ears] = keep
        else:
            P = W.F(P)
        set_co(o, P)
        print('warped', o.name, len(P))
    # ears: scale up to span brow -> nose base, re-seat on the narrowed skull
    P = get_co(face)
    for idx in ear_idx:
        E0 = fco[idx]
        sg = np.sign(E0[:, 0].mean())
        ax = np.abs(E0[:, 0])
        inner = ax.min(); zc = 0.5 * (E0[:, 2].min() + E0[:, 2].max()); yc = 0.5 * (E0[:, 1].min() + E0[:, 1].max())
        h0 = E0[:, 2].max() - E0[:, 2].min()
        brow = brow_z()
        sz = (brow - NOSE_Z) / h0; sy = 0.95 * sz; sx = 1.35
        zc_new = 0.5 * (brow + NOSE_Z)
        hw_new = 0.5 * skull_width(P[np.setdiff1d(np.arange(len(P)), np.concatenate(ear_idx))], zc_new)
        inner_new = hw_new - 0.011
        yc_new = W.G(np.array([[0.0, yc, zc]]))[0, 1]
        Q = np.empty_like(E0)
        Q[:, 0] = sg * (inner_new + (ax - inner) * sx)
        Q[:, 1] = yc_new + (E0[:, 1] - yc) * sy
        Q[:, 2] = zc_new + (E0[:, 2] - zc) * sz
        P[idx] = Q
        print(f'ear {sg:+.0f}: height {h0:.4f}->{Q[:,2].max()-Q[:,2].min():.4f}, z {Q[:,2].min():.4f}-{Q[:,2].max():.4f}, inner x {inner_new:.4f}')
    set_co(face, P)
    # neck: thicker cylinder flaring into the traps + sternocleidomastoid ridges
    neck = bpy.data.objects[NECK]
    N = get_co(neck)
    y_axis = 0.5 * (N[:, 1].min() + N[:, 1].max())
    cur_w = np.abs(N[(N[:, 2] > 1.50) & (N[:, 2] < 1.53), 0]).max() * 2
    s_top = NECK_W / cur_w
    flare = smoothstep(1.50, 1.435, N[:, 2])
    sx = s_top + 0.08 * flare; sy = s_top * 0.97 + 0.05 * flare
    Q = N.copy()
    Q[:, 0] = N[:, 0] * sx
    Q[:, 1] = y_axis + (N[:, 1] - y_axis) * sy
    for sg in (-1, 1):
        a = np.array([sg * 0.043, 0.018, 1.585]); b = np.array([sg * 0.011, -0.046, 1.445])
        ab = b - a; t = np.clip(((Q - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(Q - (a + t[:, None] * ab), axis=1)
        radial = Q - np.array([0, y_axis, 0]); radial[:, 2] = 0
        radial /= np.maximum(np.linalg.norm(radial, axis=1), 1e-6)[:, None]
        bump = 0.0032 * np.exp(-(d / 0.0105) ** 2) * np.sin(np.pi * t) ** 0.6
        Q += radial * bump[:, None]
    set_co(neck, Q)
    print(f'neck width {cur_w:.4f} -> {np.abs(Q[(Q[:,2]>1.50)&(Q[:,2]<1.53),0]).max()*2:.4f}')
    face['proportion_H23'] = 1


def stage_restore():
    """Copy original vertex positions back from the pre-proportion backup."""
    path = str(OUT / 'samurai_character_pre_proportion.blend')
    rig = bpy.data.objects['Samurai_Rig']
    names = [o.name for o in head_feature_objects(rig)] + [NECK]
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    for ob in dst.objects:
        base = ob.name.rsplit('.', 1)[0] if ob.name not in names else ob.name
        tgt = bpy.data.objects.get(base)
        if tgt and len(tgt.data.vertices) == len(ob.data.vertices):
            set_co(tgt, get_co(ob)); print('restored', base)
        me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    bpy.data.objects[FACE].pop('proportion_H23', None)


def brow_z():
    b = get_co(bpy.data.objects['Eyebrow_strands'])
    return float(0.5 * (b[:, 2].min() + b[:, 2].max()))


def skull_width(P, z, band=0.003):
    sl = P[np.abs(P[:, 2] - z) < band]
    return float(np.abs(sl[:, 0]).max() * 2)


# ----------------------------------------------------------------------------- groom helpers
HL_THETA = [0, 20, 32, 40, 48, 56, 64, 70, 74, 78, 82, 104, 110, 116, 122, 140, 180]
HL_Z = [HAIRLINE_Z, HAIRLINE_Z - 0.0005, HAIRLINE_Z - 0.005, HAIRLINE_Z - 0.0155, 1.694, 1.672, 1.648,
        1.632, 1.628, 1.650, 1.674, 1.674, 1.655, 1.615, 1.600, 1.596, 1.594]


def hairline(theta_deg):
    return np.interp(theta_deg, HL_THETA, HL_Z)


def theta_of(p):
    return math.degrees(math.atan2(abs(p[0]), -p[1]))


def bvh_from(objs_polys):
    verts = []; polys = []; off = 0
    for co, pl in objs_polys:
        verts.extend(Vector(v) for v in co)
        polys.extend(tuple(i + off for i in p) for p in pl)
        off += len(co)
    return BVHTree.FromPolygons(verts, polys)


def make_object(name, V, F, mats, mat_idx=None, uv=None, smooth=True):
    rig = bpy.data.objects['Samurai_Rig']
    old = bpy.data.objects.get(name)
    if old:
        me_old = old.data; bpy.data.objects.remove(old); bpy.data.meshes.remove(me_old)
    me = bpy.data.meshes.new(name)
    nv = len(V); F = np.asarray(F, np.int32); nf, k = F.shape
    me.vertices.add(nv); me.vertices.foreach_set('co', np.asarray(V, np.float64).ravel())
    me.loops.add(nf * k); me.loops.foreach_set('vertex_index', F.ravel())
    me.polygons.add(nf); me.polygons.foreach_set('loop_start', np.arange(0, nf * k, k, dtype=np.int32))
    me.update(calc_edges=True)
    for m in mats:
        me.materials.append(bpy.data.materials[m])
    if mat_idx is not None:
        me.polygons.foreach_set('material_index', np.asarray(mat_idx, np.int32))
    if uv is not None:
        lay = me.uv_layers.new(name='UVMap'); lay.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    me.polygons.foreach_set('use_smooth', np.full(nf, smooth))
    me.validate(); me.update()
    ob = bpy.data.objects.new(name, me)
    for c in bpy.data.objects[FACE].users_collection:
        c.objects.link(ob)
    ob.parent = rig
    vg = ob.vertex_groups.new(name='head'); vg.add(range(nv), 1.0, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return ob


def ribbons(strands):
    """strands: list of (pts Nx3, nrm Nx3, w_root, w_tip, mat). Flat cards lying along the scalp."""
    nv = sum(len(s[0]) for s in strands) * 2
    V = np.empty((nv, 3)); UVv = np.empty((nv, 2)); F = []; M = []
    a = 0
    for pts, nrm, w0, w1, mat in strands:
        n = len(pts)
        tan = np.gradient(pts, axis=0)
        side = np.cross(tan, nrm)
        side /= np.maximum(np.linalg.norm(side, axis=1), 1e-9)[:, None]
        t = np.linspace(0, 1, n)
        w = (w0 + (w1 - w0) * t ** 1.4)[:, None] * 0.5
        V[a:a + 2 * n:2] = pts - side * w; V[a + 1:a + 2 * n:2] = pts + side * w
        UVv[a:a + 2 * n:2, 0] = 0; UVv[a + 1:a + 2 * n:2, 0] = 1
        UVv[a:a + 2 * n:2, 1] = t; UVv[a + 1:a + 2 * n:2, 1] = t
        k = np.arange(n - 1) * 2 + a
        F.append(np.stack([k, k + 2, k + 3, k + 1], 1)); M.append(np.full(n - 1, mat))
        a += 2 * n
    F = np.concatenate(F); M = np.concatenate(M)
    uv = UVv[F.ravel()]
    return V, F, M, uv


def smooth_poly(p, it=2):
    p = p.copy()
    for _ in range(it):
        p[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
    return p


def catmull(ctrl, n):
    ctrl = np.asarray(ctrl, float)
    P = np.vstack([2 * ctrl[0] - ctrl[1], ctrl, 2 * ctrl[-1] - ctrl[-2]])
    seg = len(ctrl) - 1; out = []
    for t in np.linspace(0, seg, n):
        i = min(int(t), seg - 1); u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


# ----------------------------------------------------------------------------- groom
def stage_groom(n_main=11000, n_bun=1500, n_baby=900, seed=7):
    t0 = time.time()
    rng = np.random.default_rng(seed); random.seed(seed)
    rig = bpy.data.objects['Samurai_Rig']
    face = bpy.data.objects[FACE]; neck = bpy.data.objects[NECK]
    for n in OLD_HAIR:
        o = bpy.data.objects.get(n)
        if o:
            me = o.data; bpy.data.objects.remove(o); bpy.data.meshes.remove(me)
    fco = get_co(face)
    isl = islands(face)
    ears = [i for i in isl[1:] if len(i) > 1000 and np.abs(fco[i, 0]).min() > 0.06]
    ear_mask = np.zeros(len(fco), bool); ear_mask[np.concatenate(ears)] = True
    ear_c = [fco[i].mean(0) for i in ears]
    ear_top = max(fco[i, 2].max() for i in ears)
    polys = [tuple(p.vertices) for p in face.data.polygons]
    main_polys = [p for p in polys if not ear_mask[p[0]]]
    nco = get_co(neck); npolys = [tuple(p.vertices) for p in neck.data.polygons]
    bvh = bvh_from([(fco, main_polys)])
    bvh_all = bvh_from([(fco, main_polys), (nco, npolys)])

    # ---- 1. scalp emitter (also the dark underbase so no skin shows between strands)
    face.data.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in face.data.loop_triangles])
    tris = tris[~ear_mask[tris[:, 0]]]
    A, B_, C_ = fco[tris[:, 0]], fco[tris[:, 1]], fco[tris[:, 2]]
    cen = (A + B_ + C_) / 3
    th = np.degrees(np.arctan2(np.abs(cen[:, 0]), -cen[:, 1]))
    inside = cen[:, 2] >= hairline(th) - 0.003
    area = 0.5 * np.linalg.norm(np.cross(B_ - A, C_ - A), axis=1)
    sel = np.where(inside & (cen[:, 2] > 1.55))[0]
    # underbase: tris 2.5 mm inside the hairline, pushed 0.25 mm off the skin
    under = sel[cen[sel, 2] >= hairline(th[sel]) + 0.0025]
    vidx = np.unique(tris[under]); remap = -np.ones(len(fco), int); remap[vidx] = np.arange(len(vidx))
    fnorm = np.zeros_like(fco)
    tn = np.cross(B_ - A, C_ - A)
    for j in range(3):
        np.add.at(fnorm, tris[:, j], tn)
    fnorm /= np.maximum(np.linalg.norm(fnorm, axis=1), 1e-12)[:, None]
    UV_ = fco[vidx] + fnorm[vidx] * 0.00025
    UF = remap[tris[under]]
    make_object('Scalp_emitter_underbase', UV_, UF, ['Scalp_Underbase_Mat'])

    # ---- bun / convergence point: 45 deg up-and-back from the ear line on the crown
    ear_line_z = float(np.mean([c[2] for c in ear_c]))
    ray = Vector((0, 1, 1)).normalized()
    hit, nB, _, _ = bvh.ray_cast(Vector((0, 0.005, ear_line_z)), ray)
    Bp = np.array(hit); nB = np.array(nB); nB /= np.linalg.norm(nB)
    if nB @ (Bp - np.array([0, 0.005, ear_line_z])) < 0:
        nB = -nB
    # knot axis leans up the 45-degree line so it sits on the upper crown, not off the back
    nB = 0.75 * np.array(ray) + 0.25 * nB; nB /= np.linalg.norm(nB)
    rb = BUN_D / 2; ra = rb * 0.82
    tie_base = Bp + nB * 0.0015; tie_h = 0.010; tie_r = 0.0150
    bun_c = Bp + nB * (tie_h * 0.75 + ra)
    print('bun anchor', np.round(Bp, 4), 'normal', np.round(nB, 3), 'centre', np.round(bun_c, 4))

    # ---- 2. base groom: comb every strand back/up to the topknot
    pick = rng.choice(sel, size=int(n_main * 1.9), p=area[sel] / area[sel].sum())
    r1 = rng.random(len(pick)); r2 = rng.random(len(pick)); sq = np.sqrt(r1)
    roots = (1 - sq)[:, None] * A[pick] + (sq * (1 - r2))[:, None] * B_[pick] + (sq * r2)[:, None] * C_[pick]
    rth = np.degrees(np.arctan2(np.abs(roots[:, 0]), -roots[:, 1]))
    depth = roots[:, 2] - (hairline(rth) + rng.normal(0, 0.0012, len(roots)))
    keep = (depth > 0) & (rng.random(len(roots)) < np.clip(0.3 + 0.7 * depth / 0.006, 0.3, 1.0))
    roots = roots[keep][:n_main]; rdepth = depth[keep][:n_main]
    print('roots', len(roots), f'{time.time()-t0:.1f}s')
    Bv = Vector(Bp); gather = tie_r + 0.004
    strands = []
    up = Vector((0, 0, 1))
    for i, r in enumerate(roots):
        p = Vector(r)
        q, nq, _, _ = bvh.find_nearest(p)
        d0 = max((q - Bv).length, 1e-4)
        l0 = 0.0005 + rng.random() * 0.0032
        if rdepth[i] < 0.004:      # soft hairline: lie flat, thin
            l0 *= 0.4
        pts = [q + nq * l0 * 0.5]; nrm = [nq]
        dprev = None
        for _ in range(90):
            v = Bv - q; t = v - nq * v.dot(nq)
            for ec in ear_c:
                e = q - Vector(ec)
                if abs(e.y) < 0.04 and q.z < ear_top + 0.012 and abs(q.x) > 0.055 and e.length < 0.05:
                    t += (up - nq * up.dot(nq)) * (0.02 * (1 - e.length / 0.05))
            if t.length < 1e-9:
                break
            t.normalize()
            if dprev is not None:
                t = (dprev * 0.55 + t * 0.45).normalized()
            dprev = t
            q2, n2, _, _ = bvh.find_nearest(q + t * 0.003)
            q, nq = q2, n2
            prog = 1 - min(1, (q - Bv).length / d0)
            pts.append(q + nq * (l0 * (1 + 1.3 * prog) + 0.0006 * prog)); nrm.append(nq)
            if (q - Bv).length < gather:
                break
        radial = Vector(pts[-1]) - Bv; radial -= Vector(nB) * radial.dot(Vector(nB))
        radial = radial.normalized() if radial.length > 1e-6 else Vector((1, 0, 0))
        pts.append(Vector(tie_base) + Vector(nB) * 0.004 + radial * (tie_r * 0.92)); nrm.append(radial)
        pts.append(Vector(tie_base) + Vector(nB) * 0.012 + radial * (tie_r * 0.75)); nrm.append(radial)
        P = smooth_poly(np.array(pts), 2); P[0] = pts[0]
        w0 = 0.00028 if rdepth[i] < 0.004 else 0.00042
        strands.append((P, np.array(nrm), w0, 0.00034, 0 if rng.random() < 0.72 else 1))
    print('base groom', len(strands), f'{time.time()-t0:.1f}s')

    # ---- nape / behind-ear baby hairs tapering onto the neck
    baby = []
    cand = sel[(th[sel] > 112) & (np.abs(cen[sel, 2] - hairline(th[sel]) - 0.001) < 0.0045)]
    pickb = rng.choice(cand, size=n_baby, p=area[cand] / area[cand].sum())
    for j in pickb:
        w = rng.random(3); w /= w.sum()
        p = Vector(w[0] * A[j] + w[1] * B_[j] + w[2] * C_[j])
        q, nq, _, _ = bvh_all.find_nearest(p)
        L = 0.005 + rng.random() * 0.016
        down = Vector((0, 0, -1)) + Vector((-0.35 * np.sign(q.x), 0, 0)) * rng.random()
        pts = [q + nq * 0.0003]; nrm = [nq]
        for k in range(5):
            t = down - nq * down.dot(nq); t.normalize()
            q, nq, _, _ = bvh_all.find_nearest(q + t * (L / 5))
            pts.append(q + nq * (0.0003 + 0.0002 * k)); nrm.append(nq)
        baby.append((np.array(pts), np.array(nrm), 0.00022, 0.00003, 0 if rng.random() < 0.6 else 1))

    # ---- 3. framing wisps: 3 asymmetric thin clusters from the front temples
    def surf(theta, z, sg):
        d = Vector((sg * math.sin(math.radians(theta)), -math.cos(math.radians(theta)), 0))
        loc, n, _, _ = bvh.ray_cast(Vector((0, 0.0, z)), d)
        return np.array(loc), np.array(n)
    wisps = []
    for sg, th0, thc, nstr in ((1, 38, 55, 44), (1, 47, 60, 32), (-1, 41, 57, 38)):
        z0 = float(hairline(th0)) + 0.002
        c0, n0 = surf(th0, z0, sg)
        c1, n1 = surf(th0 + 7, z0 - 0.020, sg)
        c2, n2 = surf(thc, 1.634, sg)
        c3, n3 = surf(thc + 3, 1.592, sg)
        ctrl = [c0 + n0 * 0.0012, c1 + n1 * 0.004, c2 + n2 * 0.0062, c3 + n3 * 0.0072,
                c3 + n3 * 0.0095 + np.array([0, -0.004, -0.030])]
        spine = catmull(ctrl, 44)
        tang = np.gradient(spine, axis=0); tang /= np.linalg.norm(tang, axis=1)[:, None]
        sway = rng.normal(0, 1, 3) * 0.0015
        for s in range(nstr):
            ang = rng.random() * 2 * math.pi; rad = 0.0026 * math.sqrt(rng.random())
            tend = 0.82 + 0.18 * rng.random()
            n = max(12, int(44 * tend))
            pts = []; nrm = []
            for k in range(n):
                t = k / 43
                tg = Vector(tang[k]); ref = Vector((0, 0, 1)) if abs(tg.z) < 0.9 else Vector((1, 0, 0))
                b1 = tg.cross(ref).normalized(); b2 = tg.cross(b1)
                spread = rad * ((1 - t) ** 0.8 + 0.12)
                p = Vector(spine[k]) + (b1 * math.cos(ang) + b2 * math.sin(ang)) * spread + Vector(sway) * math.sin(math.pi * t)
                q, nq, _, _ = bvh_all.find_nearest(p)
                if (p - q).dot(nq) < 0.0016:
                    p = q + nq * 0.0016
                pts.append(p); nrm.append(nq)
            wisps.append((np.array(pts), np.array(nrm), 0.00030, 0.00002, 0 if s % 3 else 1))

    # ---- topknot: coiled strands on an oblate shell + wrapped tie band
    z_ax = Vector(nB); x_ax = z_ax.cross(Vector((1, 0, 0))).normalized(); y_ax = z_ax.cross(x_ax)
    Mb = np.array([x_ax, y_ax, z_ax]).T
    bun = []
    for s in range(n_bun):
        rf = 0.86 + 0.14 * rng.random() ** 0.5
        n = 46
        if rng.random() < 0.62:      # coils wrapping up from the band
            phi0 = rng.random() * 2 * math.pi; turns = 0.9 + 0.7 * rng.random()
            a0, a1 = -1.05, 0.55 + 0.95 * rng.random()
            t = np.linspace(0, 1, n)
            phi = phi0 + turns * 2 * math.pi * t; al = a0 + (a1 - a0) * t ** 0.85
            loc = np.stack([rb * np.cos(al) * np.cos(phi), rb * np.cos(al) * np.sin(phi), ra * np.sin(al)], 1)
            loc *= (1 + 0.075 * np.sin(2 * phi - 3.2 * al))[:, None]   # twisted-rope ridges of the coil
        else:                        # loops over the dome
            ax = rng.normal(0, 1, 3); ax[2] *= 0.35; ax /= np.linalg.norm(ax)
            u = np.cross(ax, [0, 0, 1.0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
            t0_ = rng.random() * 2 * math.pi; t = t0_ + np.linspace(0, math.pi * (1.1 + 0.6 * rng.random()), n)
            d = np.cos(t)[:, None] * u + np.sin(t)[:, None] * v
            d[:, 2] = np.maximum(d[:, 2], -0.80)
            d /= np.linalg.norm(d, axis=1)[:, None]
            loc = d * np.array([rb, rb, ra])
        loc *= rf * (1 + 0.04 * np.sin(np.linspace(0, 9, n) + s))[:, None]
        P = bun_c + loc @ Mb.T
        nr = loc / np.array([rb, rb, ra]) ** 2; nr = nr @ Mb.T; nr /= np.linalg.norm(nr, axis=1)[:, None]
        bun.append((P, nr, 0.00055, 0.00045, 0 if rng.random() < 0.7 else 1))

    for name, group in (('Groom_base_scalp', strands), ('Groom_nape_baby_hairs', baby),
                        ('Groom_framing_wisps', wisps), ('Topknot_coils', bun)):
        V, F, M, uv = ribbons(group)
        make_object(name, V, F, ['Black hair', 'Hair strand variation'], M, uv)
        print(name, len(group), 'strands', len(V), 'verts', f'{time.time()-t0:.1f}s')

    # hair-tie band: cord wrapped 3.3 times around the base of the knot
    turns, sides, steps, cr = 3.3, 8, 220, 0.0021
    tt = np.linspace(0, 1, steps)
    ang = tt * turns * 2 * math.pi
    centre = (tie_base + np.outer(0.0015 + tt * (tie_h - 0.003), nB)
              + tie_r * (np.outer(np.cos(ang), x_ax) + np.outer(np.sin(ang), y_ax)))
    tan = np.gradient(centre, axis=0); tan /= np.linalg.norm(tan, axis=1)[:, None]
    nrm = np.cross(tan, nB); nrm /= np.linalg.norm(nrm, axis=1)[:, None]; bin_ = np.cross(tan, nrm)
    V = []; F = []
    for i in range(steps):
        for k in range(sides):
            a = 2 * math.pi * k / sides
            V.append(centre[i] + cr * (math.cos(a) * nrm[i] + math.sin(a) * bin_[i]))
    for i in range(steps - 1):
        for k in range(sides):
            a = i * sides + k; b = i * sides + (k + 1) % sides
            F.append([a, b, b + sides, a + sides])
    make_object('Hair_tie_band', np.array(V), F, ['Dark crimson cord'])
    bpy.data.objects[FACE]['groom_bun'] = list(map(float, list(bun_c) + list(nB)))
    print(f'groom done {time.time()-t0:.1f}s')


# ----------------------------------------------------------------------------- report
def stage_report():
    face = bpy.data.objects[FACE]; P = get_co(face)
    isl = islands(face)
    ears = [i for i in isl[1:] if len(i) > 1000 and np.abs(P[i, 0]).min() > 0.06]
    em = np.zeros(len(P), bool); em[np.concatenate(ears)] = True
    M = P[~em]
    front = M[(np.abs(M[:, 0]) < 0.01) & (M[:, 1] < -0.08)]
    chin = front[:, 2].min(); top = M[:, 2].max(); Hm = top - chin
    cheek = max(skull_width(M, z, 0.002) for z in np.arange(1.615, 1.650, 0.002))
    jaw = skull_width(M, MOUTH_Z, 0.002)
    eye_w_line = skull_width(M, EYE_Z, 0.002)
    ew = get_co(bpy.data.objects['Eye white 1']); ewl = get_co(bpy.data.objects['Eye white -1'])
    e_w = ew[:, 0].max() - ew[:, 0].min(); gap = ew[:, 0].min() - ewl[:, 0].max()
    e_z = 0.5 * (ew[:, 2].min() + ew[:, 2].max())
    nb = brow_z()
    nos = min(get_co(bpy.data.objects['Nostril 1'])[:, 2].min(), get_co(bpy.data.objects['Nostril -1'])[:, 2].min())
    N = get_co(bpy.data.objects[NECK]); neck_w = np.abs(N[(N[:, 2] > 1.50) & (N[:, 2] < 1.53), 0]).max() * 2
    ear_z = [(P[i, 2].min(), P[i, 2].max()) for i in ears]
    roots = get_co(bpy.data.objects['Groom_base_scalp']) if bpy.data.objects.get('Groom_base_scalp') else None
    rows = [
        ('H (chin->skull top)', Hm, f'{Hm*100:.2f} cm (target 23.00)'),
        ('Head width @ cheekbones', cheek, f'{cheek/Hm:.3f} H (target 0.70)'),
        ('Eye line', e_z, f'{(e_z-chin)/Hm:.3f} H from chin (target 0.500)'),
        ('Eye width', e_w, f'face width at eye line / eye width = {eye_w_line/e_w:.2f} (target 5)'),
        ('Gap between eyes', gap, f'{gap/e_w:.2f} eye-widths (target 1.00)'),
        ('Upper third hairline->brow', HAIRLINE_Z - nb, f'{(HAIRLINE_Z-nb)*100:.2f} cm'),
        ('Middle third brow->nose base', nb - NOSE_Z, f'{(nb-NOSE_Z)*100:.2f} cm (nostril floor {nos:.4f})'),
        ('Lower third nose base->chin', NOSE_Z - chin, f'{(NOSE_Z-chin)*100:.2f} cm'),
        ('Ears', 0, ', '.join(f'{a:.4f}-{b:.4f}' for a, b in ear_z) + f' (brow {nb:.4f} / nose {NOSE_Z:.4f})'),
        ('Jaw width @ mouth', jaw, f'{jaw/cheek:.3f} x cheek (target 0.75-0.80)'),
        ('Neck width', neck_w, f'{neck_w/jaw:.3f} x jaw (target 0.80-0.85)'),
        ('Hairline', HAIRLINE_Z, f'{(top-HAIRLINE_Z)/Hm:.3f} H below skull top (target 0.15)'),
    ]
    bun = face.get('groom_bun')
    if bun:
        Tk = get_co(bpy.data.objects['Topknot_coils'])
        c = np.array(bun[:3]); n = np.array(bun[3:])
        rel = Tk - c; rad = rel - np.outer(rel @ n, n)
        d = 2 * np.linalg.norm(rad, axis=1).max()
        rows.append(('Topknot diameter', d, f'{d/Hm:.3f} H (target 0.25-0.30)'))
    for r in rows:
        print(f'{r[0]:32s} {r[1]:8.4f}  {r[2]}')
    return rows


def stage_save():
    rig = bpy.data.objects['Samurai_Rig']
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for ob in rig.children:
        if ob.type == 'MESH':
            ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'samurai_character.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_nla_strips=True, export_skins=True,
                              export_draco_mesh_compression_enable=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'samurai_character.blend'))


if __name__ == '__main__' or 'STAGE' in globals():
    st = globals().get('STAGE', 'all')
    if st in ('restore',): stage_restore()
    if st in ('warp', 'all'): stage_warp()
    if st in ('groom', 'all'): stage_groom()
    if st in ('report', 'all'): stage_report()
    if st in ('save',): stage_save()
