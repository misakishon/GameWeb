"""Clean, smooth, anatomically accurate East Asian male samurai head rebuild.

Replaces the cobbled-together head/neck/floating-feature patches with:
  1. A single unified, high-resolution, curve-aligned quad head + neck mesh
     with real open eyelids (with palpebral thickness), sculpted nose with
     integrated nostril cavities, integrated sculpted lips with Cupid's bow
     and recessed oral fissure, smooth youthful cheeks, defined masculine jaw,
     and seamless neck blending into the kimono collar.
  2. Real 3D anatomical eyeballs (sclera + concave textured dark-brown iris +
     pupil + glossy transparent cornea dome + inner pink caruncle).
  3. Clean sculpted anatomical ears (helix, scapha, antihelix, concha, tragus,
     lobe) aligned strictly between brow ridge and nose base.
  4. Multi-zone anatomical skin shading (Cycles Random Walk SSS, smooth cheek /
     nose / lip / socket / ear color zones, T-zone roughness variation, ultra-fine
     micro-pore normal detail).
  5. Natural masculine East Asian eyebrows, delicate eyelashes, and a volumetric
     3-layer samurai hair groom (feathered scalp hairline, soft-volume swept base
     into an upper-crown coiled topknot with tie band, nape baby hairs, and
     delicate asymmetric temple framing wisps).

All proportions strictly follow Total Head Height H = 23.0 cm.
"""

import bpy
import bmesh
import math
import random
import time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from pathlib import Path

OUT = Path(r'C:/TrainAi/Animated/public/models')

# =============================================================================
# STRICT ANATOMICAL CONSTANTS (Total Head Height H = 23.0 cm)
# =============================================================================
H = 0.2300
CHIN_Z = 1.5320
TOP_Z = CHIN_Z + H                  # 1.7620
EYE_Z = CHIN_Z + 0.50 * H           # 1.6470 (exact vertical midpoint)
HAIRLINE_Z = 1.7145                 # compact masculine forehead matching reference (hair loft adds ~1.8 cm above!)
BROW_Z = 1.6625                     # strong masculine brow closer to eyes
NOSE_BASE_Z = 1.6015                # middle third: brow -> nose base
                                    # lower third: nose base -> chin (~6.95 cm)
MOUTH_Z = 1.5775                    # oral fissure (~1/3 below nose base)

CHEEK_W = 0.70 * H                  # 0.1610 m at cheekbones
JAW_W = 0.78 * CHEEK_W              # 0.1256 m at gonion (aligned with mouth)
NECK_W = 0.85 * JAW_W               # 0.1068 m strong athletic male neck matching reference
BUN_DIAM = 0.278 * H                # 0.0639 m prominent sculpted samurai topknot (measured ~0.29H with coils)

# Eye geometry: 5 eye-widths across ~15.6 cm eye-line face width => ~3.10 cm each
EYE_X = 0.0314                      # eye centers at +/- 3.14 cm
EYE_HALF_W = 0.0155                 # eye width = 3.10 cm; inner gap = 3.18 cm (~1.03 eye widths)
EYE_Y = -0.0870                     # eyeball center recessed inside orbit (front pole at -0.1002, ~8 mm behind brow!)
EYE_R = 0.0132                      # full globe so inner/outer corners have ZERO dark gap!

OLD_HEAD_PREFIXES = (
    'head__Face_warm_skin', 'neck__Warm_skin',
    'Eye white', 'Eye_ball', 'Eye_cornea', 'Eye_caruncle', 'Eye_tearline',
    'Iris', 'Pupil', 'Cornea_glints',
    'Upper lid', 'Palpebral rim', 'Lower lid',
    'Upper lip', 'Lower lip', 'Nostril',
    'Eyebrow_strands', 'Eyelash_strands',
    'Fine_hair_dark', 'head__Hair_strand_variation', 'head__Black_hair',
    'head__Dark_crimson_cord',
    'Scalp_emitter_underbase', 'Groom_', 'Topknot_', 'Hair_tie_band',
    'Hair_Scalp_Groom', 'Hair_Baby_Hairs', 'Hair_Framing_Wisps',
    'Hair_Topknot_Bun', 'Hair_Eyebrows', 'Hair_Eyelashes',
    'Ear_L', 'Ear_R',
)


# =============================================================================
# MATH HELPERS
# =============================================================================
def ss(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss(x, mu, sig):
    return np.exp(-0.5 * ((np.asarray(x, dtype=np.float64) - mu) / sig) ** 2)


def pchip(xs, ys):
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0] = d[0]
    m[-1] = d[-1]
    for k in range(1, len(xs) - 1):
        if d[k - 1] * d[k] <= 0.0:
            m[k] = 0.0
        else:
            w1 = 2.0 * h[k] + h[k - 1]
            w2 = h[k] + 2.0 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

    def fn(x):
        x = np.asarray(x, dtype=np.float64)
        scalar = (x.ndim == 0)
        x1 = np.atleast_1d(x)
        out = np.empty_like(x1)
        lo = x1 <= xs[0]
        hi = x1 >= xs[-1]
        mid = ~(lo | hi)
        out[lo] = ys[0]
        out[hi] = ys[-1]
        xm = x1[mid]
        i = np.clip(np.searchsorted(xs, xm) - 1, 0, len(xs) - 2)
        t = (xm - xs[i]) / h[i]
        t2 = t * t
        t3 = t2 * t
        out[mid] = ((2 * t3 - 3 * t2 + 1) * ys[i]
                    + (t3 - 2 * t2 + t) * h[i] * m[i]
                    + (-2 * t3 + 3 * t2) * ys[i + 1]
                    + (t3 - t2) * h[i] * m[i + 1])
        return float(out[0]) if scalar else out
    return fn


def eye_curves(ax):
    """Upper and lower eyelid Z curves as functions of |x|."""
    inner = EYE_X - EYE_HALF_W       # 0.0159
    outer = EYE_X + EYE_HALF_W       # 0.0469
    t = np.clip((ax - inner) / (outer - inner), 0.0, 1.0)
    # Sharp, calm, noble East Asian male canthal tilt (+2.4 mm upward laterally)
    mid = EYE_Z - 0.0014 + 0.0024 * t
    # Sleek, focused almond opening (~7.6 mm height at center; upper lid rests calmly over top ~28% of iris!)
    s_up = np.sin(np.pi * np.power(t, 0.82))
    s_lo = np.sin(np.pi * np.power(t, 1.08))
    z_up = mid + 0.0040 * np.power(np.maximum(s_up, 0.0), 0.82)
    z_lo = mid - 0.0036 * np.power(np.maximum(s_lo, 0.0), 0.90)
    return mid, z_up, z_lo, t


def eye_lid_y(ax, z):
    """Smooth eyelid-wrapping arc in front of the recessed eyeball (no corner cliff!)."""
    # Wrap radius 21 mm centered slightly behind eyeball center so:
    # - at center: sits 1.4 mm cleanly in front of cornea pole (EYE_Y - EYE_R)
    # - at inner/outer corners (dx = 15.6 mm): sweeps smoothly ~6.5 mm back into the canthus!
    r_wrap = 0.0215
    y_wrap_c = EYE_Y + 0.0079
    dx = np.asarray(ax, dtype=np.float64) - EYE_X
    dz = np.asarray(z, dtype=np.float64) - EYE_Z
    # Slight natural lateral angle of the orbital plane (outer corner slightly deeper than inner)
    lateral_slant = 0.14 * dx
    d2 = np.maximum(1e-6, r_wrap * r_wrap - dx * dx - (0.85 * dz) ** 2)
    return y_wrap_c - np.sqrt(d2) + lateral_slant


def mouth_curve(ax):
    """Natural relaxed masculine oral fissure Z(x), upper & lower lip boundaries."""
    w = 0.0252  # half-width = 2.52 cm (5.04 cm total mouth width)
    u = np.clip(ax / w, 0.0, 1.0)
    # Calm horizontal mouth line with subtle central tubercle dip & gentle corners
    z_line = MOUTH_Z - 0.00055 * np.exp(-(ax / 0.0045) ** 2) + 0.00045 * np.sin(np.pi * u) ** 1.5 - 0.00020 * (u ** 3)
    # Upper lip vermilion with crisp natural Cupid's bow peaks at |x| = 5.5 mm
    arch = np.maximum(0.0, 1.0 - u ** 2.1) ** 0.72
    cupid = 0.0012 * np.exp(-((ax - 0.0056) / 0.0038) ** 2) - 0.00080 * np.exp(-(ax / 0.0032) ** 2)
    z_upper = z_line + (0.0072 * arch + cupid * (1.0 - u))
    # Lower lip vermilion: fuller, youthful masculine lower lip matching reference
    arch_lo = np.maximum(0.0, 1.0 - (u / 0.94) ** 2.1) ** 0.66
    z_lower = z_line - 0.0092 * arch_lo
    return z_line, z_upper, z_lower, u


def remove_old_head_objects(rig):
    removed = []
    for o in list(bpy.data.objects):
        if o.type in ('MESH', 'CURVES') and any(o.name == p or o.name.startswith(p) for p in OLD_HEAD_PREFIXES):
            removed.append(o.name)
            data = o.data
            ot = o.type
            bpy.data.objects.remove(o, do_unlink=True)
            if data and data.users == 0:
                if ot == 'MESH':
                    bpy.data.meshes.remove(data)
                elif ot == 'CURVES':
                    bpy.data.hair_curves.remove(data)
    print(f"Removed {len(removed)} old head/hair objects")


def link_to_rig(ob, rig, weights_dict):
    """Parent to rig, assign vertex groups, add Armature modifier."""
    # Link to same collection as rig
    for col in rig.users_collection:
        if ob.name not in col.objects:
            col.objects.link(ob)
    ob.parent = rig
    for bname, w_arr in weights_dict.items():
        vg = ob.vertex_groups.get(bname) or ob.vertex_groups.new(name=bname)
        if np.isscalar(w_arr):
            vg.add(list(range(len(ob.data.vertices))), float(w_arr), 'REPLACE')
        else:
            for idx, val in enumerate(w_arr):
                if val > 1e-4:
                    vg.add([idx], float(val), 'REPLACE')
    mod = ob.modifiers.get('Armature') or ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# =============================================================================
# 1. UNIFIED SMOOTH ANATOMICAL HEAD + NECK MESH
# =============================================================================
def build_head_and_neck(rig):
    t0 = time.time()

    # Non-uniform angular sampling: dense on front face, medium on sides/back
    # phi = 0 is front (-Y), +/-pi/2 is sides (+/-X), +/-pi is back (+Y)
    u_lin = np.linspace(-1.0, 1.0, 212, endpoint=False)
    # Cubic warp concentrates ~65% of columns in the front hemisphere
    phi = np.pi * (0.58 * u_lin + 0.42 * (u_lin ** 3))
    n_u = len(phi)

    # Vertical parameter s along meridian:
    #   s in [0.00, 0.20]: neck (z 1.432 -> 1.522)
    #   s in [0.20, 0.28]: submental / under-jaw transition
    #   s in [0.28, 0.86]: face chin (1.532) -> forehead -> hairline (1.7275) -> brow/crown
    #   s in [0.86, 1.00]: skull dome -> crown apex (1.762)
    s_neck = np.linspace(0.00, 0.20, 24, endpoint=False)
    s_sub = np.linspace(0.20, 0.28, 16, endpoint=False)
    s_face = np.linspace(0.28, 0.84, 136, endpoint=False)
    s_top = np.linspace(0.84, 0.996, 26)
    s_vals = np.concatenate([s_neck, s_sub, s_face, s_top])
    n_v = len(s_vals)

    # Smooth C2 PCHIP curves defining the macro head + neck profile vs s
    # Keys: s -> (z_front, z_back, rx, y_front, y_back, squareness_front)
    # Careful natural ovoid cranium + graceful tapering jawline (NOT boxy!)
    keys = np.array([
        #   s      z_f     z_b     rx      y_f     y_b     sq
        [0.00,  1.432,  1.438,  0.0585, -0.058,  0.050,  0.04],  # collar base / athletic traps flare
        [0.08,  1.468,  1.474,  0.0548, -0.054,  0.047,  0.04],  # lower neck
        [0.15,  1.498,  1.508,  0.0534, -0.053,  0.045,  0.03],  # strong athletic male neck (W = 10.68 cm)
        [0.20,  1.519,  1.536,  0.0525, -0.053,  0.047,  0.03],  # throat / upper neck
        [0.24,  1.529,  1.556,  0.0502, -0.075,  0.055,  0.05],  # crisp submental floor (clean jawline shadow!)
        [0.27,  1.533,  1.570,  0.0480, -0.097,  0.064,  0.08],  # under-chin curve (menton=1.532!)
        [0.30,  1.538,  1.580,  0.0485, -0.108,  0.072,  0.10],  # firm chiseled masculine chin
        [0.34,  1.549,  1.591,  0.0545, -0.112,  0.079,  0.11],  # chin eminence -> clean mandibular body
        [0.39,  1.564,  1.605,  0.0604, -0.109,  0.086,  0.11],  # defined lower jaw sweeping to gonion
        [0.435, 1.5775, 1.618,  0.0638, -0.110,  0.092,  0.10],  # mouth / crisp gonion (W = 12.76 cm)
        [0.49,  1.594,  1.632,  0.0682, -0.108,  0.097,  0.09],  # upper lip / taut athletic lower cheek
        [0.54,  1.608,  1.644,  0.0736, -0.108,  0.100,  0.08],  # alar / mid cheek plane
        [0.60,  1.624,  1.658,  0.0794, -0.107,  0.102,  0.08],  # lower malar
        [0.65,  1.636,  1.670,  0.0812, -0.106,  0.103,  0.08],  # cheekbones (W = 16.2 cm = 0.70H)
        [0.69,  1.647,  1.680,  0.0795, -0.105,  0.103,  0.06],  # eye line (exact 0.50H)
        [0.74,  1.6645, 1.694,  0.0780, -0.107,  0.101,  0.07],  # brow ridge / temples
        [0.79,  1.688,  1.710,  0.0772, -0.104,  0.096,  0.06],  # mid forehead / parietal
        [0.84,  1.713,  1.725,  0.0725, -0.095,  0.088,  0.04],  # upper forehead (smooth ovoid!)
        [0.88,  1.730,  1.738,  0.0640, -0.080,  0.076,  0.02],  # hairline / rounded frontal dome
        [0.93,  1.747,  1.750,  0.0475, -0.052,  0.056,  0.01],  # upper crown dome
        [0.97,  1.757,  1.758,  0.0265, -0.022,  0.034,  0.00],  # near apex
        [1.00,  1.762,  1.762,  0.0005,  0.006,  0.012,  0.00],  # crown apex (TOP_Z = 1.762)
    ])

    f_zf = pchip(keys[:, 0], keys[:, 1])
    f_zb = pchip(keys[:, 0], keys[:, 2])
    f_rx = pchip(keys[:, 0], keys[:, 3])
    f_yf = pchip(keys[:, 0], keys[:, 4])
    f_yb = pchip(keys[:, 0], keys[:, 5])
    f_sq = pchip(keys[:, 0], keys[:, 6])

    # Build 2D grid (n_v, n_u)
    S = s_vals[:, None]
    P = phi[None, :]
    sinp = np.sin(P)
    cosp = np.cos(P)
    ap = np.abs(P)

    # Blend factor from front (0) to back (1)
    back_w = ss(0.45, 2.55, ap)
    front_w = 1.0 - back_w

    zf = f_zf(S)
    zb = f_zb(S)
    rx = f_rx(S)
    yf = f_yf(S)
    yb = f_yb(S)
    sq = f_sq(S)

    # Smooth cross-section: gentle superellipse for masculine jawline & brow plane
    # Superellipse exponent p_exp slightly > 2 on front face gives clean plane separation
    # (front plane vs side plane) without sharp corners!
    p_exp = 2.0 + sq * (1.0 - 0.55 * back_w)
    ax_u = np.abs(sinp)
    ay_u = np.abs(cosp)
    # Superellipse radius scaling (smooth, C-inf everywhere except zero which is fine)
    denom = np.power(np.power(ax_u + 1e-12, p_exp) + np.power(ay_u + 1e-12, p_exp), 1.0 / p_exp)
    cx = sinp / denom
    cy = -cosp / denom  # -1 at front (phi=0), +1 at back (phi=+/-pi)

    # X, Y, Z base macro surface
    yc = 0.5 * (yf + yb)
    ry_f = yc - yf
    ry_b = yb - yc
    ry = np.where(cy <= 0.0, ry_f, ry_b)

    X = rx * cx
    Y = yc + ry * cy
    Z = zf * front_w + zb * back_w

    # Smooth jawline shape: graceful V-to-U masculine mandible from gonion down to refined chin
    # Keep full gonion width at back-sides (ap ~ 1.35) while tapering smoothly forward to chin!
    chin_refine = 1.0 - 0.14 * gauss(S, 0.31, 0.042) * np.exp(-((ap - 0.55) / 0.45) ** 2)
    X *= chin_refine

    # Clean masculine gonion (jaw angle) & crisp mandibular border separating face from neck
    gonion_env = gauss(Z, MOUTH_Z - 0.005, 0.013) * gauss(ap, 1.28, 0.26)
    X += np.sign(X) * 0.0032 * gonion_env
    # Crisp mandibular lower edge (subtle outward ridge along jaw border so it catches clean rim/shadow!)
    jaw_edge_z = 1.535 + 0.036 * ss(0.25, 1.35, ap)
    jaw_ridge = gauss(Z, jaw_edge_z, 0.0085) * ss(0.15, 0.45, ap) * (1.0 - ss(1.25, 1.60, ap))
    X += np.sign(X) * 0.0018 * jaw_ridge
    Y -= 0.0012 * jaw_ridge * ss(0.0, 0.6, cosp)

    # Chiseled cheekbone / zygomatic arch prominence catching key light (matching reference!)
    zygo_env = gauss(Z, 1.631, 0.015) * gauss(ap, 0.78, 0.34)
    X += np.sign(X) * 0.0028 * zygo_env
    Y -= 0.0036 * gauss(Z, 1.627, 0.015) * gauss(np.abs(X), 0.042, 0.016) * ss(0.1, 0.6, cosp)

    # Taut, sculpted athletic cheek plane (smoothly tapered — neither puffy nor gaunt!)
    cheek_plane = gauss(Z, 1.594, 0.018) * gauss(np.abs(X), 0.050, 0.015) * ss(0.0, 0.55, cosp)
    Y += 0.0012 * cheek_plane
    # Stronger sculpted sternocleidomastoid (SCM) ridges on athletic male neck
    scm_strength = 0.0034

    # Subtle trapezius & sternocleidomastoid (SCM) muscle flow on the neck
    neck_m = ss(1.565, 1.515, Z) * ss(1.425, 1.455, Z)
    # Trapezius flare at back-sides near base
    traps = ss(1.510, 1.440, Z) * gauss(ap, 1.95, 0.55)
    X += np.sign(X) * 0.011 * traps
    Y += 0.004 * ss(1.495, 1.438, Z) * ss(1.6, 2.8, ap)
    # SCM diagonal ridge from behind ear (x=0.045, y=0.018, z=1.565) to sternum (x=0.014, y=-0.052, z=1.445)
    t_scm = np.clip((1.565 - Z) / 0.120, 0.0, 1.0)
    scm_x = 0.045 * (1.0 - t_scm) + 0.014 * t_scm
    scm_y = 0.018 * (1.0 - t_scm) - 0.052 * t_scm
    d_scm = np.sqrt((np.abs(X) - scm_x) ** 2 + (Y - scm_y) ** 2)
    scm_bump = scm_strength * np.exp(-(d_scm / 0.0115) ** 2) * np.sin(np.pi * t_scm) ** 0.7 * neck_m
    rad_xy = np.sqrt(X * X + Y * Y) + 1e-9
    X += (X / rad_xy) * scm_bump
    Y += (Y / rad_xy) * scm_bump
    # Subtle suprasternal notch & subtle laryngeal (Adam's apple) contour
    adams = 0.0016 * gauss(X, 0.0, 0.009) * gauss(Z, 1.503, 0.009) * ss(0.3, 0.8, cosp)
    notch = 0.0032 * gauss(X, 0.0, 0.013) * gauss(Z, 1.452, 0.014) * ss(0.3, 0.8, cosp)
    Y += (-adams + notch)

    # Gentle mastoid & occipital curve behind ears
    occiput = gauss(Z, 1.655, 0.038) * ss(1.9, 2.9, ap)
    Y += 0.0025 * occiput

    # =========================================================================
    # CURVE-ALIGNED ROW WARP FOR RAZOR-CLEAN EYE & MOUTH LOOPS
    # =========================================================================
    # Find the exact grid rows nearest EYE_Z and MOUTH_Z on the front face
    front_col = np.argmin(np.abs(phi))
    row_eye = int(np.argmin(np.abs(Z[:, front_col] - EYE_Z)))
    row_mouth = int(np.argmin(np.abs(Z[:, front_col] - MOUTH_Z)))
    print(f"Aligned rows: row_eye={row_eye} (z={Z[row_eye, front_col]:.4f}), row_mouth={row_mouth} (z={Z[row_mouth, front_col]:.4f})")

    # Smoothly warp Z around row_eye so row_eye follows the exact almond midline
    # and the adjacent rows follow the exact upper/lower eyelid curves!
    ax = np.abs(X)
    in_front = ss(0.25, 0.70, cosp)
    eye_mid_z, eye_up_z, eye_lo_z, eye_t = eye_curves(ax)
    eye_x_env = ss(0.006, 0.016, ax) * (1.0 - ss(0.047, 0.058, ax)) * in_front
    eye_row_env = np.exp(-((np.arange(n_v)[:, None] - row_eye) / 8.0) ** 2)
    Z += (eye_mid_z - EYE_Z) * eye_x_env * eye_row_env

    # Smoothly warp Z around row_mouth so row_mouth follows the exact oral fissure curve!
    m_line_z, m_up_z, m_lo_z, m_u = mouth_curve(ax)
    mouth_x_env = (1.0 - ss(0.022, 0.036, ax)) * in_front
    mouth_row_env = np.exp(-((np.arange(n_v)[:, None] - row_mouth) / 7.0) ** 2)
    Z += (m_line_z - MOUTH_Z) * mouth_x_env * mouth_row_env

    # =========================================================================
    # ANATOMICAL FACIAL SCULPTING (Smooth, Clean, Human Planes)
    # =========================================================================
    ax = np.abs(X)

    # --- A. FOREHEAD, GLABELLA & STRONG MASCULINE SUPRAORBITAL BROW RIDGE ---
    # Stronger, more sculptural brow ridge overhanging the eyes like the reference samurai!
    brow_arch_z = BROW_Z - 0.0016 * np.exp(-(ax / 0.014) ** 2) + 0.0024 * np.exp(-((ax - 0.036) / 0.017) ** 2) - 0.0036 * ss(0.044, 0.062, ax)
    brow_ridge = np.exp(-((Z - brow_arch_z) / 0.0072) ** 2) * (1.0 - ss(0.048, 0.064, ax)) * in_front
    Y -= 0.0074 * brow_ridge
    # Defined glabella plane between the brows
    glabella = np.exp(-0.5 * ((ax / 0.012) ** 2 + ((Z - (BROW_Z - 0.0015)) / 0.0065) ** 2)) * in_front
    Y -= 0.0024 * glabella
    # Subtle frontal eminence (smooth masculine forehead fullness above brow)
    forehead_full = gauss(Z, 1.698, 0.022) * (1.0 - ss(0.046, 0.072, ax)) * in_front
    Y -= 0.0020 * forehead_full
    # Clean temporal plane transition at sides of forehead
    temple_plane = gauss(Z, 1.680, 0.020) * gauss(ax, 0.063, 0.011) * ss(0.0, 0.55, cosp)
    X -= np.sign(X) * 0.0022 * temple_plane

    # --- B. ORBITAL SOCKETS & EYELIDS ---
    # Deeper, more sculpted masculine orbital socket (rich natural overhang shadow under brow!)
    orb_dx = (ax - EYE_X) / 0.0205
    orb_dz = (Z - (EYE_Z + 0.0022)) / 0.0140
    orb_r2 = orb_dx * orb_dx + orb_dz * orb_dz
    orb_recess = np.exp(-0.85 * orb_r2) * in_front
    medial_orb = np.exp(-((ax - 0.0168) / 0.0075) ** 2) * np.exp(-((Z - (EYE_Z + 0.0035)) / 0.0095) ** 2) * in_front
    Y += 0.0074 * orb_recess + 0.0042 * medial_orb

    # Conform the eyelid skin cleanly IN FRONT OF the recessed 3D eyeball using the smooth wrap arc!
    y_wrap = eye_lid_y(ax, Z)
    eye_mid_z, eye_up_z, eye_lo_z, eye_t = eye_curves(ax)
    in_eye_x = ss(EYE_X - EYE_HALF_W - 0.006, EYE_X - EYE_HALF_W + 0.001, ax) * (1.0 - ss(EYE_X + EYE_HALF_W - 0.001, EYE_X + EYE_HALF_W + 0.006, ax))

    # Upper eyelid hood/drape wrapping smoothly over the eyeball (authentic East Asian upper lid fullness!)
    dz_up = Z - eye_up_z
    upper_lid_w = np.exp(-((dz_up - 0.0030) / 0.0065) ** 2) * ss(-0.0022, 0.0006, dz_up) * in_eye_x * in_front
    # Subtle East Asian tapered double-lid crease ~2.3 mm above upper lid margin
    crease_h = 0.0020 + 0.0015 * np.sin(np.pi * np.clip(eye_t, 0.0, 1.0)) ** 0.75
    lid_crease = np.exp(-((dz_up - crease_h) / 0.0012) ** 2) * ss(0.10, 0.28, eye_t) * (1.0 - ss(0.84, 0.98, eye_t)) * in_eye_x * in_front

    # Lower eyelid cushion (soft youthful orbicularis roll / aegyo-sal)
    dz_lo = eye_lo_z - Z
    lower_lid_w = np.exp(-((dz_lo - 0.0026) / 0.0055) ** 2) * ss(-0.0022, 0.0006, dz_lo) * in_eye_x * in_front
    lower_roll = np.exp(-((dz_lo - 0.0026) / 0.0024) ** 2) * in_eye_x * in_front
    tear_trough = np.exp(-((dz_lo - 0.0080) / 0.0028) ** 2) * ss(0.0, 0.22, eye_t) * (1.0 - ss(0.55, 0.90, eye_t)) * in_eye_x * in_front

    # Smoothly blend orbital skin onto the smooth eyelid wrap arc (covers full eye width including corners!)
    lid_blend = np.clip(0.96 * upper_lid_w + 0.92 * lower_lid_w, 0.0, 0.98)
    Y = Y * (1.0 - lid_blend) + (y_wrap - 0.0006) * lid_blend
    # Upper lid hood drape + crisp crease + soft lower lid roll
    Y -= 0.0018 * upper_lid_w + 0.0010 * lower_roll
    Y += 0.0014 * lid_crease + 0.0006 * tear_trough

    # --- C. SCULPTED CHISELED EAST ASIAN MALE NOSE (Clean bridge highlight, rounded tip, crisp alar wings) ---
    nose_z_top = 1.6530        # nasion
    nose_z_tip = 1.6108        # pronasale (tip)
    nose_z_base = NOSE_BASE_Z  # 1.6015 (subnasale)

    # Dorsal profile: distinct straight refined masculine bridge catching clean light, flowing into rounded tip!
    t_bridge = np.clip((nose_z_top - Z) / (nose_z_top - nose_z_tip), 0.0, 1.0)
    tip_env = ss(nose_z_top + 0.008, nose_z_top - 0.003, Z) * ss(nose_z_base - 0.004, nose_z_tip + 0.005, Z)
    bridge_proj = (0.0034 + 0.0102 * np.power(t_bridge, 0.85)) * tip_env
    # Crisp narrower bridge ridge (~5.6 mm) widening smoothly toward refined tip (~8.6 mm)
    nose_sigma_x = 0.0058 + 0.0032 * np.power(t_bridge, 1.15)
    nose_cross = np.exp(-0.5 * np.power(ax / nose_sigma_x, 2.5))
    # Clean sloped nasal sidewalls framing the bridge cleanly
    sidewall = np.exp(-0.5 * (ax / (nose_sigma_x * 1.65)) ** 2) * ss(nose_z_top + 0.005, nose_z_top - 0.006, Z) * ss(nose_z_base - 0.003, nose_z_tip, Z)
    Y -= (bridge_proj * nose_cross + 0.0046 * (t_bridge ** 0.72) * sidewall) * in_front

    # Broad, softly rounded natural nasal tip (lobule) — natural East Asian fullness (zero pinch!)
    tip_ball = np.exp(-0.5 * ((ax / 0.0098) ** 2 + ((Z - 1.6094) / 0.0092) ** 2)) * in_front
    Y -= 0.0086 * tip_ball

    # Smooth columella & gentle nasolabial transition
    col_env = np.exp(-0.5 * ((ax / 0.0046) ** 2 + ((Z - 1.6038) / 0.0062) ** 2)) * in_front
    Y -= 0.0066 * col_env

    # Distinct, softly rounded alar wings (nostril sides) curving cleanly into the alar crease
    ala = np.exp(-0.5 * (((ax - 0.0118) / 0.0056) ** 2 + ((Z - 1.6066) / 0.0054) ** 2)) * in_front
    Y -= 0.0094 * ala
    # Crisp alar crease where nostril wing tucks into cheek
    ala_crease = np.exp(-0.5 * (((ax - 0.0170) / 0.0022) ** 2 + ((Z - 1.6075) / 0.0058) ** 2)) * in_front
    Y += 0.0024 * ala_crease

    # Recessed nostril cavities underneath
    nostril_cav = np.exp(-0.5 * (((ax - 0.0078) / 0.0028) ** 2 + ((Z - 1.6022) / 0.0022) ** 2)) * in_front
    Y += 0.0054 * nostril_cav
    Z += 0.0018 * nostril_cav

    # Defined nasion indentation right between the eyes so the straight bridge reads clearly!
    nasion_dip = np.exp(-0.5 * ((ax / 0.0070) ** 2 + ((Z - 1.6525) / 0.0058) ** 2)) * in_front
    Y += 0.0028 * nasion_dip

    # --- D. PHILTRUM, INTEGRATED SCULPTED LIPS, MOUTH CORNERS & CHIN ---
    m_line_z, m_up_z, m_lo_z, m_u = mouth_curve(ax)

    # Gentle muzzle / dental arch convexity
    muzzle = np.exp(-0.5 * ((ax / 0.029) ** 2 + ((Z - 1.577) / 0.020) ** 2)) * in_front
    Y -= 0.0048 * muzzle

    # Very subtle soft philtrum (NOT sharp twin ridges!)
    phil_z = ss(1.583, 1.589, Z) * ss(1.601, 1.595, Z) * in_front
    phil_dimple = np.exp(-(ax / 0.0040) ** 2) * phil_z
    phil_ridge = np.exp(-((ax - 0.0052) / 0.0028) ** 2) * phil_z
    Y += 0.0008 * phil_dimple - 0.0004 * phil_ridge

    # Upper lip sculpted pillow (crisp masculine fullness, downward-angled upper lip plane!)
    u_lip_t = (Z - m_line_z) / np.maximum(m_up_z - m_line_z, 1e-4)
    in_ulip = (u_lip_t > 0.0) & (u_lip_t < 1.0) & (ax < 0.0265)
    ulip_profile = np.where(in_ulip, np.sin(np.pi * np.clip(u_lip_t, 0.0, 1.0)) ** 0.65, 0.0)
    ulip_tubercle = 1.0 + 0.16 * np.exp(-(ax / 0.0065) ** 2)
    ulip_proj = 0.0062 * ulip_profile * ulip_tubercle * (1.0 - m_u ** 2.15) * in_front
    Y -= ulip_proj

    # Lower lip sculpted pillow (fuller, firm masculine cushion matching reference!)
    l_lip_t = (m_line_z - Z) / np.maximum(m_line_z - m_lo_z, 1e-4)
    in_llip = (l_lip_t > 0.0) & (l_lip_t < 1.0) & (ax < 0.0255)
    llip_profile = np.where(in_llip, np.sin(np.pi * np.clip(l_lip_t, 0.0, 1.0)) ** 0.62, 0.0)
    llip_proj = 0.0076 * llip_profile * (1.0 - m_u ** 2.0) * in_front
    Y -= llip_proj

    # Crisp oral fissure crease + relaxed corner dimples
    fissure = np.exp(-((Z - m_line_z) / 0.0011) ** 2) * (1.0 - ss(0.0215, 0.0265, ax)) * in_front
    Y += 0.0044 * fissure
    corner_tuck = np.exp(-0.5 * (((ax - 0.0255) / 0.0038) ** 2 + ((Z - (MOUTH_Z - 0.0005)) / 0.0038) ** 2)) * in_front
    Y += 0.0024 * corner_tuck

    # Defined mentolabial shadow fold & firm chiseled masculine chin pad
    mento_fold = np.exp(-0.5 * ((ax / 0.017) ** 2 + ((Z - 1.5595) / 0.0056) ** 2)) * in_front
    Y += 0.0038 * mento_fold
    chin_pad = np.exp(-0.5 * ((ax / 0.0155) ** 2 + ((Z - 1.5435) / 0.0090) ** 2)) * in_front
    Y -= 0.0046 * chin_pad

    # Very subtle youthful nasolabial plane transition (NEVER deep age wrinkles!)
    nl_x = 0.0175 + 0.012 * np.clip((1.608 - Z) / 0.032, 0.0, 1.0)
    nl_env = np.exp(-((ax - nl_x) / 0.005) ** 2) * ss(1.576, 1.588, Z) * ss(1.610, 1.600, Z) * in_front
    Y += 0.0006 * nl_env

    # =========================================================================
    # BUILD BMESH + OPEN CLEAN ALMOND EYE APERTURES WITH PALPEBRAL THICKNESS
    # =========================================================================
    bm = bmesh.new()
    grid_verts = []
    for iv in range(n_v):
        row = []
        for iu in range(n_u):
            v = bm.verts.new((float(X[iv, iu]), float(Y[iv, iu]), float(Z[iv, iu])))
            row.append(v)
        grid_verts.append(row)

    # Crown pole vertex
    v_top = bm.verts.new((0.0, 0.011, TOP_Z))
    # Bottom neck cap center (hidden inside chest/collar)
    v_bot = bm.verts.new((0.0, -0.003, 1.428))

    # Determine which faces lie strictly inside the almond eye opening
    eye_face_inside = np.zeros((n_v - 1, n_u), dtype=bool)
    for iv in range(n_v - 1):
        for iu in range(n_u):
            iu2 = (iu + 1) % n_u
            cx_f = 0.25 * (X[iv, iu] + X[iv, iu2] + X[iv + 1, iu] + X[iv + 1, iu2])
            cy_f = 0.25 * (Y[iv, iu] + Y[iv, iu2] + Y[iv + 1, iu] + Y[iv + 1, iu2])
            cz_f = 0.25 * (Z[iv, iu] + Z[iv, iu2] + Z[iv + 1, iu] + Z[iv + 1, iu2])
            if cy_f < -0.05:
                acx = abs(cx_f)
                if (EYE_X - EYE_HALF_W + 0.0005) < acx < (EYE_X + EYE_HALF_W - 0.0005):
                    _, zu, zl, _ = eye_curves(acx)
                    if zl < cz_f < zu:
                        eye_face_inside[iv, iu] = True

    # Create quad faces (skipping the eye apertures)
    for iv in range(n_v - 1):
        for iu in range(n_u):
            if eye_face_inside[iv, iu]:
                continue
            iu2 = (iu + 1) % n_u
            v00 = grid_verts[iv][iu]
            v01 = grid_verts[iv][iu2]
            v11 = grid_verts[iv + 1][iu2]
            v10 = grid_verts[iv + 1][iu]
            bm.faces.new((v00, v01, v11, v10))

    # Cap crown and neck bottom
    for iu in range(n_u):
        iu2 = (iu + 1) % n_u
        bm.faces.new((grid_verts[n_v - 1][iu], grid_verts[n_v - 1][iu2], v_top))
        bm.faces.new((grid_verts[0][iu2], grid_verts[0][iu], v_bot))

    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # Remove unused vertices strictly inside the eye aperture
    unused = [v for v in bm.verts if len(v.link_faces) == 0]
    for v in unused:
        bm.verts.remove(v)

    # Smooth the eye aperture boundary loop onto the EXACT almond curve & eyeball surface,
    # then extrude inward 2.4 mm to create real 3D eyelid thickness (palpebral margin)!
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    boundary_verts = list({v for e in boundary_edges for v in e.verts})

    # Snap boundary verts smoothly onto the exact almond lid curve hugging the smooth wrap arc
    for v in boundary_verts:
        sg = 1.0 if v.co.x >= 0 else -1.0
        ax_v = abs(v.co.x)
        ax_c = float(np.clip(ax_v, EYE_X - EYE_HALF_W, EYE_X + EYE_HALF_W))
        zm, zu, zl, _ = eye_curves(ax_c)
        # Snap to upper or lower curve depending on side of midline
        zt = float(zu if v.co.z >= zm else zl)
        yt = float(eye_lid_y(ax_c, zt)) - 0.0008
        v.co = Vector((sg * ax_c, yt, zt))

    # Extrude eyelid margin inward in 2 smooth steps (rolled palpebral thickness + deep socket tuck)
    ret1 = bmesh.ops.extrude_edge_only(bm, edges=boundary_edges)
    ring1_verts = [el for el in ret1['geom'] if isinstance(el, bmesh.types.BMVert)]
    ring1_edges = [el for el in ret1['geom'] if isinstance(el, bmesh.types.BMEdge)]
    for v in ring1_verts:
        # Clean 1.8 mm eyelid thickness rolling straight back toward the eyeball!
        v.co.y += 0.0018

    ret2 = bmesh.ops.extrude_edge_only(bm, edges=ring1_edges)
    ring2_verts = [el for el in ret2['geom'] if isinstance(el, bmesh.types.BMVert)]
    for v in ring2_verts:
        v.co.y += 0.0045  # tuck deeply behind the eyeball equator so zero gaps ever appear!

    # Recalculate consistent outward normals
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # =========================================================================
    # SELECTIVE TAUBIN SMOOTHING (Butter-smooth macro skin, preserves crisp eyes/lips/nostrils)
    # =========================================================================
    bm.verts.ensure_lookup_table()
    pin_set = set(boundary_verts) | set(ring1_verts) | set(ring2_verts)

    def vert_smooth_weight(co):
        # Preserve crisp chiseled anatomy on eyelids, nose bridge/wings/nostrils, lips, and brow ridge;
        # smooth macro skin planes (cheeks, forehead, jaw, neck, cranium) cleanly!
        w = 1.0
        acx = abs(co.x)
        if co.y < -0.05:
            # Protect eye aperture rim & eyelid crease
            if (EYE_X - EYE_HALF_W - 0.005) < acx < (EYE_X + EYE_HALF_W + 0.005) and abs(co.z - EYE_Z) < 0.010:
                w *= 0.14
            # Protect oral fissure, Cupid's bow & fuller lip contours
            if acx < 0.027 and abs(co.z - MOUTH_Z) < 0.009:
                w *= 0.16
            # Protect entire sculpted nose (bridge ridge, tip, alar wings, alar crease, nostrils!)
            if acx < 0.019 and 1.599 < co.z < 1.653:
                w *= 0.15
            # Protect supraorbital brow ridge slightly so it stays chiseled
            if acx < 0.052 and abs(co.z - BROW_Z) < 0.007:
                w *= 0.35
        return w

    nbrs = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    sw = np.array([0.0 if v in pin_set else vert_smooth_weight(v.co) for v in bm.verts])

    # 6 iterations of Taubin lambda/mu smoothing (zero shrinkage, silky C2 surface!)
    for _ in range(6):
        for lam in (0.42, -0.44):
            coords = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
            new_c = coords.copy()
            for i, nb in enumerate(nbrs):
                if sw[i] > 0.0 and nb:
                    avg = coords[nb].mean(axis=0)
                    new_c[i] = coords[i] + (lam * sw[i]) * (avg - coords[i])
            for i, v in enumerate(bm.verts):
                v.co = new_c[i]

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # Convert bmesh to Blender mesh
    me = bpy.data.meshes.new('head__Face_warm_skin')
    bm.to_mesh(me)
    bm.free()

    # Smooth shading on all polygons
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    me.update()

    # Create object & link to Samurai_Rig
    ob = bpy.data.objects.new('head__Face_warm_skin', me)

    # Compute smooth bone weights across chest / neck / head
    co_all = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co_all)
    co_all = co_all.reshape(-1, 3)
    zs = co_all[:, 2]
    ys = co_all[:, 1]

    # Blend head/neck cleanly across z=1.525..1.565 (front chin stays 100% head!)
    z_split = 1.538 - 0.014 * ss(-0.04, -0.09, ys)
    w_head = ss(z_split - 0.018, z_split + 0.022, zs)
    w_chest = ss(1.472, 1.438, zs)
    w_neck = np.clip(1.0 - w_head - w_chest, 0.0, 1.0)
    tot = w_head + w_neck + w_chest + 1e-8
    link_to_rig(ob, rig, {
        'head': w_head / tot,
        'neck': w_neck / tot,
        'chest': w_chest / tot,
    })

    # Add Subdivision Surface (level 1 viewport & render) for silky smooth organic contour!
    sub = ob.modifiers.new('Subsurf', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    # Place Subsurf AFTER Armature or BEFORE? Putting Subsurf BEFORE Armature or AFTER works cleanly;
    # after Armature keeps rest pose smooth and fast.

    # Paint anatomical facial vertex colors (SkinColor + RoughnessMap) directly onto mesh!
    paint_facial_vertex_colors(me)

    print(f"Built unified head+neck: {len(me.vertices)} verts, {len(me.polygons)} polys in {time.time()-t0:.2f}s")
    return ob


# =============================================================================
# 2. ANATOMICAL SKIN COLOR & ROUGHNESS VERTEX ATTRIBUTES
# =============================================================================
def paint_facial_vertex_colors(me, is_ear=False):
    """Analytical human East Asian male skin albedo + roughness variation."""
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    ax = np.abs(x)
    in_front = ss(-0.02, -0.075, y)

    # Rich warm-olive natural East Asian male skin base (matching reference portrait!)
    col = np.tile(np.array([0.445, 0.275, 0.186, 1.0], dtype=np.float64), (len(co), 1))
    rough = np.full(len(co), 0.45, dtype=np.float64)

    if is_ear:
        # Subtle warm redness along ear helix & lobe, soft ambient darkening inside concha
        concha = np.exp(-((z - 1.630) / 0.011) ** 2) * ss(0.088, 0.076, ax)
        rim = ss(0.081, 0.091, ax)
        col[:, 0] += 0.035 * rim - 0.14 * concha
        col[:, 1] -= 0.015 * rim + 0.11 * concha
        col[:, 2] -= 0.015 * rim + 0.08 * concha
        rough[:] = 0.42
    else:
        # 1. Warm rosy cheek / malar flush (vitality!)
        cheek_flush = np.exp(-0.5 * (((ax - 0.040) / 0.022) ** 2 + ((z - 1.622) / 0.019) ** 2)) * in_front
        col[:, 0] += 0.038 * cheek_flush
        col[:, 1] -= 0.016 * cheek_flush
        col[:, 2] -= 0.014 * cheek_flush

        # 2. Warm subtle blood-flow on nose tip & alar wings
        nose_warm = np.exp(-0.5 * ((ax / 0.014) ** 2 + ((z - 1.609) / 0.011) ** 2)) * in_front
        col[:, 0] += 0.032 * nose_warm
        col[:, 1] -= 0.018 * nose_warm
        col[:, 2] -= 0.015 * nose_warm

        # 3. Forehead subtle warm-golden highlight tone
        forehead = np.exp(-0.5 * ((ax / 0.045) ** 2 + ((z - 1.695) / 0.026) ** 2)) * in_front
        col[:, 0] += 0.022 * forehead
        col[:, 1] += 0.018 * forehead
        col[:, 2] += 0.008 * forehead

        # 4. Subtle natural masculine lower-face / jaw coolness (faint healthy olive shadow)
        jaw_cool = np.exp(-0.5 * ((ax / 0.042) ** 2 + ((z - 1.558) / 0.024) ** 2)) * in_front
        col[:, 0] -= 0.024 * jaw_cool
        col[:, 1] -= 0.012 * jaw_cool
        col[:, 2] += 0.002 * jaw_cool

        # 5. Subtle neck & under-chin ambient warmth/darkening
        neck_shade = ss(1.542, 1.515, z) * (1.0 - 0.35 * ss(1.485, 1.445, z))
        col[:, :3] *= (1.0 - 0.09 * neck_shade)[:, None]
        # Under-chin shadow zone
        submental = ss(-0.105, -0.055, y) * np.exp(-((z - 1.528) / 0.014) ** 2)
        col[:, :3] *= (1.0 - 0.14 * submental)[:, None]

        # 6. Richer natural orbital socket, under-brow, eyelid crease & lash-line shading
        orb_tint = np.exp(-0.5 * (((ax - EYE_X) / 0.018) ** 2 + ((z - (EYE_Z + 0.003)) / 0.011) ** 2)) * in_front
        col[:, 0] -= 0.062 * orb_tint
        col[:, 1] -= 0.054 * orb_tint
        col[:, 2] -= 0.040 * orb_tint

        # Darken immediate upper lash line & inner lid rim for crisp, intense masculine eye framing
        _, zu, zl, et = eye_curves(ax)
        in_ex = ss(EYE_X - EYE_HALF_W - 0.002, EYE_X - EYE_HALF_W + 0.001, ax) * (1.0 - ss(EYE_X + EYE_HALF_W - 0.001, EYE_X + EYE_HALF_W + 0.002, ax))
        lash_line = np.exp(-((z - zu) / 0.0016) ** 2) * in_ex * in_front
        lo_lash = np.exp(-((z - zl) / 0.0014) ** 2) * in_ex * in_front
        col[:, :3] *= (1.0 - 0.50 * lash_line - 0.22 * lo_lash)[:, None]

        # 7. Darkened recessed nostril cavities + subtle alar crease depth
        nostril_dark = np.exp(-0.5 * (((ax - 0.0078) / 0.0030) ** 2 + ((z - 1.6022) / 0.0024) ** 2)) * in_front
        ala_shade = np.exp(-0.5 * (((ax - 0.0168) / 0.0025) ** 2 + ((z - 1.6075) / 0.0055) ** 2)) * in_front
        col[:, :3] *= (1.0 - 0.90 * nostril_dark - 0.14 * ala_shade)[:, None]

        # 8. NATURAL FEATHERED MASCULINE LIPS (richer warm muted terracotta-rose, upper slightly darker!)
        m_line_z, m_up_z, m_lo_z, m_u = mouth_curve(ax)
        u_dist_top = (m_up_z - z) / 0.0018
        u_dist_bot = (z - m_line_z) / 0.0008
        l_dist_top = (m_line_z - z) / 0.0008
        l_dist_bot = (z - m_lo_z) / 0.0022
        m_x_fade = 1.0 - ss(0.0205, 0.0258, ax)
        u_mask = ss(-0.5, 1.0, u_dist_top) * ss(-0.3, 0.8, u_dist_bot) * m_x_fade * in_front
        l_mask = ss(-0.3, 0.8, l_dist_top) * ss(-0.5, 1.0, l_dist_bot) * m_x_fade * in_front

        ulip_rgb = np.array([0.275, 0.122, 0.102])
        llip_rgb = np.array([0.360, 0.162, 0.135])
        col[:, :3] = col[:, :3] * (1.0 - u_mask)[:, None] + ulip_rgb * u_mask[:, None]
        col[:, :3] = col[:, :3] * (1.0 - l_mask)[:, None] + llip_rgb * l_mask[:, None]

        # Natural darkened oral fissure crease, corner shadow & subtle mentolabial shadow below lower lip
        fissure_d = np.exp(-((z - m_line_z) / 0.0011) ** 2) * m_x_fade * in_front
        corner_d = np.exp(-0.5 * (((ax - 0.0255) / 0.0034) ** 2 + ((z - MOUTH_Z) / 0.0034) ** 2)) * in_front
        mento_d = np.exp(-0.5 * ((ax / 0.016) ** 2 + ((z - 1.5605) / 0.0045) ** 2)) * in_front
        col[:, :3] *= (1.0 - 0.62 * fissure_d - 0.22 * corner_d - 0.14 * mento_d)[:, None]

        # 9. Stronger brow-bed shadow under masculine eyebrows so brows feel deeply rooted!
        brow_z_c = (BROW_Z - 0.0032) - 0.0012 * np.exp(-(ax / 0.015) ** 2) + 0.0020 * np.exp(-((ax - 0.036) / 0.016) ** 2) - 0.003 * ss(0.044, 0.056, ax)
        brow_bed = np.exp(-((z - brow_z_c) / 0.0042) ** 2) * ss(0.008, 0.014, ax) * (1.0 - ss(0.048, 0.057, ax)) * in_front
        col[:, :3] *= (1.0 - 0.34 * brow_bed)[:, None]

        # 10. Subtle scalp darkening ONLY well inside the hairline (hidden under hair strands)
        th_deg = np.degrees(np.arctan2(ax, -y))
        hl_z = hairline_z_at(th_deg)
        in_scalp = ss(hl_z + 0.004, hl_z + 0.020, z)
        col[:, :3] *= (1.0 - 0.42 * in_scalp)[:, None]

        # --- ROUGHNESS & SPECULAR T-ZONE MAP ---
        # Lifelike specular sheen across cheekbones, bridge/tip of nose, forehead, and lips!
        tzone = (1.05 * np.exp(-0.5 * ((ax / 0.012) ** 2 + ((z - 1.625) / 0.026) ** 2))
                 + 0.85 * np.exp(-0.5 * ((ax / 0.036) ** 2 + ((z - 1.692) / 0.019) ** 2))
                 + 0.90 * np.exp(-0.5 * (((ax - 0.044) / 0.018) ** 2 + ((z - 1.628) / 0.015) ** 2))) * in_front
        rough = 0.49 - 0.16 * np.clip(tzone, 0.0, 1.0) - 0.19 * np.clip(u_mask + l_mask, 0.0, 1.0)
        rough = np.clip(rough, 0.25, 0.54)

    col = np.clip(col, 0.0, 1.0)

    # Write vertex color attributes (POINT domain -> smoothly interpolated across Subsurf!)
    if 'SkinColor' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['SkinColor'])
    ca = me.color_attributes.new(name='SkinColor', type='FLOAT_COLOR', domain='POINT')
    ca.data.foreach_set('color', col.astype(np.float32).ravel())

    if 'SkinRough' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['SkinRough'])
    ra = me.color_attributes.new(name='SkinRough', type='FLOAT_COLOR', domain='POINT')
    r_rgba = np.stack([rough, rough, rough, np.ones_like(rough)], axis=1)
    ra.data.foreach_set('color', r_rgba.astype(np.float32).ravel())


# =============================================================================
# 3. REAL 3D ANATOMICAL EYEBALLS + GLOSSY CORNEA + CARUNCLE
# =============================================================================
def build_eyes(rig):
    for s, tag in ((1, 'L'), (-1, 'R')):
        cx = s * EYE_X
        center = Vector((cx, EYE_Y, EYE_Z))

        # A. Inner Eyeball (Sclera + Concave Iris + Pupil)
        bm = bmesh.new()
        n_lat, n_lon = 40, 48
        verts_grid = []
        # Polar angle theta=0 is front (-Y), theta=pi is back (+Y)
        thetas = np.concatenate([
            np.linspace(0.008, 0.56, 20, endpoint=False),  # dense across pupil & iris!
            np.linspace(0.56, np.pi - 0.05, n_lat - 20)
        ])
        for th in thetas:
            row = []
            # Slight anatomical concavity across iris disc (gives realistic depth under cornea!)
            r_local = EYE_R
            if th < 0.50:
                iris_u = th / 0.50
                r_local = EYE_R * (0.972 + 0.028 * (iris_u ** 2))
            for j in range(n_lon):
                ph = 2.0 * math.pi * j / n_lon
                x = cx + r_local * math.sin(th) * math.cos(ph)
                z = EYE_Z + r_local * math.sin(th) * math.sin(ph)
                y = EYE_Y - r_local * math.cos(th)
                row.append(bm.verts.new((x, y, z)))
            verts_grid.append(row)
        v_front = bm.verts.new((cx, EYE_Y - EYE_R * 0.968, EYE_Z))
        v_back = bm.verts.new((cx, EYE_Y + EYE_R, EYE_Z))

        for i in range(len(thetas) - 1):
            for j in range(n_lon):
                j2 = (j + 1) % n_lon
                bm.faces.new((verts_grid[i][j], verts_grid[i + 1][j], verts_grid[i + 1][j2], verts_grid[i][j2]))
        for j in range(n_lon):
            j2 = (j + 1) % n_lon
            bm.faces.new((v_front, verts_grid[0][j], verts_grid[0][j2]))
            bm.faces.new((verts_grid[-1][j2], verts_grid[-1][j], v_back))

        # Subtle attentive gaze toward viewer's right (+4.5 deg yaw around eyeball center)
        gaze_rot = Matrix.Rotation(math.radians(-4.5), 3, 'Z')
        for v in bm.verts:
            v.co = center + gaze_rot @ (v.co - center)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f'Eye_ball_{tag}')
        bm.to_mesh(me)
        bm.free()
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))

        # Paint high-res procedural eye vertex colors in eyeball-local (gaze-aligned!) coordinates
        co = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        rel_w = co - np.array([cx, EYE_Y, EYE_Z])
        inv_gaze = np.array(gaze_rot.inverted(), dtype=np.float64)
        rel_l = rel_w @ inv_gaze.T
        dx = rel_l[:, 0]
        dy = -rel_l[:, 1]
        dz = rel_l[:, 2]
        rad_2d = np.sqrt(dx * dx + dz * dz)
        ang_2d = np.arctan2(dz, dx)
        # Radius of iris ~6.30 mm (prominent soulful East Asian obsidian-espresso iris), pupil ~2.4 mm
        r_pupil = 0.00240
        r_iris = 0.00630

        # Sclera color: soft natural off-white with rich upper-lid shadow & corner shading (no glaring white!)
        sclera = np.tile(np.array([0.70, 0.67, 0.64]), (len(co), 1))
        corner_pink = ss(0.0074, 0.0122, rad_2d)
        sclera[:, 0] += 0.03 * corner_pink
        sclera[:, 1] -= 0.08 * corner_pink
        sclera[:, 2] -= 0.08 * corner_pink
        top_ao = ss(0.0002, 0.0055, dz)
        sclera *= (1.0 - 0.50 * top_ao)[:, None]

        # Deep obsidian-espresso East Asian iris matching reference!
        fiber = (0.5 + 0.25 * np.sin(ang_2d * 29.0 + rad_2d * 240.0)
                 + 0.15 * np.sin(ang_2d * 53.0 - rad_2d * 180.0)
                 + 0.10 * np.cos(ang_2d * 17.0))
        iris_u = np.clip((rad_2d - r_pupil) / (r_iris - r_pupil), 0.0, 1.0)
        limbal = ss(0.65, 0.98, iris_u)
        iris_col = np.empty((len(co), 3), dtype=np.float64)
        iris_col[:, 0] = (0.022 + 0.014 * fiber * (1.0 - 0.5 * iris_u)) * (1.0 - 0.85 * limbal)
        iris_col[:, 1] = (0.010 + 0.006 * fiber * (1.0 - 0.5 * iris_u)) * (1.0 - 0.86 * limbal)
        iris_col[:, 2] = (0.005 + 0.003 * fiber * (1.0 - 0.5 * iris_u)) * (1.0 - 0.88 * limbal)
        iris_col *= (1.0 - 0.42 * ss(0.0002, 0.0050, dz))[:, None]

        pupil_col = np.array([0.002, 0.002, 0.002])

        # Blend sclera -> iris -> pupil only on front hemisphere (dy > 0)
        in_iris = (1.0 - ss(r_iris - 0.00045, r_iris + 0.00035, rad_2d)) * (dy > 0.0)
        in_pupil = (1.0 - ss(r_pupil - 0.00020, r_pupil + 0.00020, rad_2d)) * (dy > 0.0)
        rgb = sclera * (1.0 - in_iris)[:, None] + iris_col * in_iris[:, None]
        rgb = rgb * (1.0 - in_pupil)[:, None] + pupil_col * in_pupil[:, None]
        rgba = np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((len(co), 1))], axis=1)

        ca = me.color_attributes.new(name='EyeColor', type='FLOAT_COLOR', domain='POINT')
        ca.data.foreach_set('color', rgba.astype(np.float32).ravel())
        me.update()

        ob = bpy.data.objects.new(f'Eye_ball_{tag}', me)
        link_to_rig(ob, rig, {'head': 1.0})

        # B. Glossy Transparent Cornea Shell (aligned with attentive gaze, catches crisp catchlight!)
        bm_c = bmesh.new()
        bmesh.ops.create_uvsphere(bm_c, u_segments=32, v_segments=20, radius=EYE_R + 0.00035)
        for v in bm_c.verts:
            if v.co.y < -0.006:
                r2 = v.co.x ** 2 + v.co.z ** 2
                v.co.y -= 0.00085 * math.exp(-r2 / (0.0060 ** 2))
            v.co = center + gaze_rot @ v.co
        me_c = bpy.data.meshes.new(f'Eye_cornea_{tag}')
        bm_c.to_mesh(me_c)
        bm_c.free()
        me_c.polygons.foreach_set('use_smooth', np.ones(len(me_c.polygons), dtype=bool))
        me_c.update()
        ob_c = bpy.data.objects.new(f'Eye_cornea_{tag}', me_c)
        link_to_rig(ob_c, rig, {'head': 1.0})

        # D. Moist Lower-Lid Tear Meniscus (ultra-subtle glossy tear bead hugging lower lid margin!)
        bm_t = bmesh.new()
        n_seg = 24
        n_ring = 8
        tr_r = 0.00028
        rings = []
        for i in range(n_seg):
            u = (i + 0.5) / n_seg
            ax_t = (EYE_X - EYE_HALF_W + 0.0022) + u * (2.0 * EYE_HALF_W - 0.0042)
            _, _, zl_t, _ = eye_curves(ax_t)
            y_t = float(eye_lid_y(ax_t, zl_t)) + 0.00035
            c_t = Vector((s * ax_t, y_t, float(zl_t) + 0.00025))
            ring = []
            for k in range(n_ring):
                ang = 2.0 * math.pi * k / n_ring
                ring.append(bm_t.verts.new(c_t + Vector((0.0, tr_r * math.cos(ang), tr_r * math.sin(ang)))))
            rings.append(ring)
        for i in range(n_seg - 1):
            for k in range(n_ring):
                k2 = (k + 1) % n_ring
                bm_t.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]))
        bmesh.ops.recalc_face_normals(bm_t, faces=bm_t.faces)
        me_t = bpy.data.meshes.new(f'Eye_tearline_{tag}')
        bm_t.to_mesh(me_t)
        bm_t.free()
        me_t.polygons.foreach_set('use_smooth', np.ones(len(me_t.polygons), dtype=bool))
        me_t.update()
        ob_t = bpy.data.objects.new(f'Eye_tearline_{tag}', me_t)
        link_to_rig(ob_t, rig, {'head': 1.0})

        # C. Inner Canthus Caruncle (moist pink inner corner filling gap cleanly against eyeball)
        bm_k = bmesh.new()
        bmesh.ops.create_uvsphere(bm_k, u_segments=14, v_segments=10, radius=1.0)
        ax_car = EYE_X - EYE_HALF_W + 0.0016
        _, zu_c, zl_c, _ = eye_curves(ax_car)
        z_car = 0.5 * (zu_c + zl_c)
        y_car = float(eye_lid_y(ax_car, z_car)) + 0.0014
        for v in bm_k.verts:
            v.co = Vector((s * (ax_car + v.co.x * 0.0024), y_car + v.co.y * 0.0020, z_car + v.co.z * 0.0017))
        me_k = bpy.data.meshes.new(f'Eye_caruncle_{tag}')
        bm_k.to_mesh(me_k)
        bm_k.free()
        me_k.polygons.foreach_set('use_smooth', np.ones(len(me_k.polygons), dtype=bool))
        me_k.update()
        ob_k = bpy.data.objects.new(f'Eye_caruncle_{tag}', me_k)
        link_to_rig(ob_k, rig, {'head': 1.0})


# =============================================================================
# 4. CLEAN SCULPTED ANATOMICAL EARS (Aligned Brow -> Nose Base)
# =============================================================================
def build_ears(rig, face_obj):
    # Ear spans strictly from NOSE_BASE_Z (1.6015) to BROW_Z (1.6645) -> height 6.30 cm
    ear_h = BROW_Z - NOSE_BASE_Z
    ear_zc = 0.5 * (BROW_Z + NOSE_BASE_Z)
    ear_yc = 0.012  # tucked cleanly behind jaw ramus

    # Compute skull surface X at ear location so ear roots seat cleanly into the head
    fco = np.empty(len(face_obj.data.vertices) * 3, dtype=np.float64)
    face_obj.data.vertices.foreach_get('co', fco)
    fco = fco.reshape(-1, 3)
    sl = fco[(np.abs(fco[:, 2] - ear_zc) < 0.008) & (np.abs(fco[:, 1] - ear_yc) < 0.015)]
    skull_x = float(np.abs(sl[:, 0]).max()) if len(sl) else 0.075

    # Build sculpted ear in local (u_back, v_up) coordinates using a clean deformed solid pillow
    # u in [-1, 1] (front to back), v in [-1, 1] (bottom lobe to top helix)
    for s, tag in ((1, 'L'), (-1, 'R')):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=44, v_segments=32, radius=1.0)
        # Deform unit sphere into clean anatomical human ear!
        for v in bm.verts:
            # Map sphere coords: lx=outward thickness, ly=front(-)/back(+), lz=down(-)/up(+)
            lx, ly, lz = v.co.x, v.co.y, v.co.z
            # Ear silhouette outline: wider on top-back, tapers gently to rounded earlobe at bottom
            w_scale = 0.0175 * (0.95 + 0.18 * lz - 0.15 * (lz ** 2) + 0.12 * ss(-0.4, 0.6, lz))
            h_scale = 0.5 * ear_h
            # Shift upper ear slightly backward (natural 12 deg cant)
            y_loc = ly * w_scale + 0.0055 * lz + 0.003 * (1.0 - lz * lz)
            z_loc = lz * h_scale

            # Base thickness (flattened cup)
            out_sign = 1.0 if lx >= 0.0 else -1.0
            # Splay ear gently outward toward the back (+y), anchored smoothly into skull at front (-y)
            splay = 0.0145 * ss(-0.85, 0.85, ly) * (0.65 + 0.35 * (1.0 - 0.3 * lz * lz))
            thick = 0.0038 * (0.75 + 0.25 * (1.0 - abs(lz)))

            if lx > 0.0:
                # Outer ear anatomy (lateral surface): helix, scapha, antihelix, concha, tragus, lobe
                r_edge = math.sqrt(ly * ly + lz * lz)
                # Rolled outer helix rim around top & back border
                helix = math.exp(-((r_edge - 0.88) / 0.14) ** 2) * ss(-0.55, 0.05, lz) * ss(-0.75, -0.15, ly)
                # Scapha groove just inside helix
                scapha = math.exp(-((r_edge - 0.68) / 0.12) ** 2) * ss(-0.25, 0.25, lz) * ss(-0.15, 0.35, ly)
                # Antihelix Y-ridge curving around concha
                anti = math.exp(-((r_edge - 0.50) / 0.14) ** 2) * ss(-0.45, 0.15, lz) * ss(-0.20, 0.30, ly)
                # Deep concha bowl (central depression leading to ear canal)
                concha = math.exp(-(((ly + 0.18) / 0.36) ** 2 + ((lz + 0.06) / 0.36) ** 2))
                # Tragus bump in front of ear canal
                tragus = math.exp(-(((ly + 0.72) / 0.22) ** 2 + ((lz + 0.14) / 0.24) ** 2))
                # Soft rounded earlobe at bottom
                lobe = math.exp(-(((ly + 0.10) / 0.45) ** 2 + ((lz + 0.80) / 0.24) ** 2))

                relief = (0.0034 * helix - 0.0022 * scapha + 0.0024 * anti
                          - 0.0052 * concha + 0.0032 * tragus + 0.0022 * lobe)
                x_off = splay + lx * thick + relief * (0.35 + 0.65 * lx)
            else:
                # Back of ear curves smoothly into skull root
                x_off = splay * (1.0 + 0.35 * lx) + lx * thick

            # Seat root cleanly 5 mm inside the skull so there is zero gap
            x_world = s * (skull_x - 0.0055 + x_off)
            y_world = ear_yc + y_loc
            z_world = ear_zc + z_loc
            v.co = Vector((x_world, y_world, z_world))

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f'Ear_{tag}')
        bm.to_mesh(me)
        bm.free()
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
        paint_facial_vertex_colors(me, is_ear=True)
        me.update()

        ob = bpy.data.objects.new(f'Ear_{tag}', me)
        link_to_rig(ob, rig, {'head': 1.0})


# =============================================================================
# 5. REALISTIC CYCLES MATERIALS (Skin, Eyes, Cornea, Caruncle, Hair, Cord)
# =============================================================================
def setup_materials(face_obj):
    # --- A. FILM-GRADE HUMAN SKIN MATERIAL (Random Walk SSS + Pores + T-Zone Specularity + Living Variation) ---
    mat = bpy.data.materials.get('Face warm skin') or bpy.data.materials.new('Face warm skin')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.subsurface_method = 'RANDOM_WALK'

    col_attr = nt.nodes.new('ShaderNodeAttribute')
    col_attr.attribute_name = 'SkinColor'
    rough_attr = nt.nodes.new('ShaderNodeAttribute')
    rough_attr.attribute_name = 'SkinRough'

    tex_coord = nt.nodes.new('ShaderNodeTexCoord')

    # 1. Dual-frequency skin pore & micro-grain bump (crisp subtle human pores up close!)
    vor_pores = nt.nodes.new('ShaderNodeTexVoronoi')
    vor_pores.inputs['Scale'].default_value = 820.0
    vor_pores.inputs['Randomness'].default_value = 0.88

    noise_grain = nt.nodes.new('ShaderNodeTexNoise')
    noise_grain.inputs['Scale'].default_value = 260.0
    noise_grain.inputs['Detail'].default_value = 6.0
    noise_grain.inputs['Roughness'].default_value = 0.60

    noise_macro = nt.nodes.new('ShaderNodeTexNoise')
    noise_macro.inputs['Scale'].default_value = 34.0
    noise_macro.inputs['Detail'].default_value = 4.0
    noise_macro.inputs['Roughness'].default_value = 0.50

    mix_pore = nt.nodes.new('ShaderNodeMix')
    mix_pore.data_type = 'FLOAT'
    mix_pore.inputs['Factor'].default_value = 0.52

    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.082
    bump.inputs['Distance'].default_value = 0.00048

    # 2. Living skin capillary/melanin color variation (breaks up CG uniformity subtly!)
    ramp_tone = nt.nodes.new('ShaderNodeValToRGB')
    ramp_tone.color_ramp.elements[0].position = 0.22
    ramp_tone.color_ramp.elements[0].color = (0.87, 0.80, 0.77, 1.0)
    ramp_tone.color_ramp.elements[1].position = 0.78
    ramp_tone.color_ramp.elements[1].color = (1.03, 1.00, 0.98, 1.0)

    mix_col = nt.nodes.new('ShaderNodeMix')
    mix_col.data_type = 'RGBA'
    mix_col.blend_type = 'MULTIPLY'
    mix_col.inputs['Factor'].default_value = 0.085

    # 3. Micro-roughness variation driven by pore noise + anatomical T-zone map
    rough_map = nt.nodes.new('ShaderNodeMapRange')
    rough_map.inputs['From Min'].default_value = 0.25
    rough_map.inputs['From Max'].default_value = 0.75
    rough_map.inputs['To Min'].default_value = -0.045
    rough_map.inputs['To Max'].default_value = 0.045

    rough_add = nt.nodes.new('ShaderNodeMath')
    rough_add.operation = 'ADD'
    rough_add.use_clamp = True

    # 4. Lifelike T-zone micro-sebum Coat Weight (brighter natural specularity on nose, cheeks, forehead!)
    coat_inv = nt.nodes.new('ShaderNodeMapRange')
    coat_inv.inputs['From Min'].default_value = 0.26
    coat_inv.inputs['From Max'].default_value = 0.50
    coat_inv.inputs['To Min'].default_value = 0.20
    coat_inv.inputs['To Max'].default_value = 0.04

    bsdf.inputs['Subsurface Weight'].default_value = 0.30
    bsdf.inputs['Subsurface Scale'].default_value = 0.0072
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.33, 0.17)
    bsdf.inputs['IOR'].default_value = 1.42
    bsdf.inputs['Specular IOR Level'].default_value = 0.50
    bsdf.inputs['Coat Roughness'].default_value = 0.24

    nt.links.new(tex_coord.outputs['Object'], vor_pores.inputs['Vector'])
    nt.links.new(tex_coord.outputs['Object'], noise_grain.inputs['Vector'])
    nt.links.new(tex_coord.outputs['Object'], noise_macro.inputs['Vector'])
    nt.links.new(vor_pores.outputs['Distance'], mix_pore.inputs['A'])
    nt.links.new(noise_grain.outputs['Fac'], mix_pore.inputs['B'])
    nt.links.new(mix_pore.outputs['Result'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    nt.links.new(noise_macro.outputs['Fac'], ramp_tone.inputs['Fac'])
    nt.links.new(col_attr.outputs['Color'], mix_col.inputs['A'])
    nt.links.new(ramp_tone.outputs['Color'], mix_col.inputs['B'])
    nt.links.new(mix_col.outputs['Result'], bsdf.inputs['Base Color'])

    nt.links.new(noise_grain.outputs['Fac'], rough_map.inputs['Value'])
    nt.links.new(rough_attr.outputs['Fac'], rough_add.inputs[0])
    nt.links.new(rough_map.outputs['Result'], rough_add.inputs[1])
    nt.links.new(rough_add.outputs['Value'], bsdf.inputs['Roughness'])

    nt.links.new(rough_attr.outputs['Fac'], coat_inv.inputs['Value'])
    nt.links.new(coat_inv.outputs['Result'], bsdf.inputs['Coat Weight'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # Assign skin material to face and ears
    for name in ('head__Face_warm_skin', 'Ear_L', 'Ear_R'):
        o = bpy.data.objects.get(name)
        if o:
            o.data.materials.clear()
            o.data.materials.append(mat)

    # Sync body/hands skin ('Warm skin') to match the face's warm natural East Asian tone!
    ws = bpy.data.materials.get('Warm skin')
    if ws and ws.use_nodes:
        for n in ws.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Base Color'].default_value = (0.445, 0.275, 0.186, 1.0)
                n.inputs['Subsurface Weight'].default_value = 0.28
                n.inputs['Subsurface Scale'].default_value = 0.006
                n.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.18)
                n.inputs['Roughness'].default_value = 0.46

    # --- B. EYEBALL MATERIAL (Vertex Color Sclera + Iris + Pupil) ---
    mat_eye = bpy.data.materials.get('Human_Eyeball_Mat') or bpy.data.materials.new('Human_Eyeball_Mat')
    mat_eye.use_nodes = True
    nt = mat_eye.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    ca = nt.nodes.new('ShaderNodeAttribute')
    ca.attribute_name = 'EyeColor'
    bsdf.inputs['Roughness'].default_value = 0.18
    bsdf.inputs['Specular IOR Level'].default_value = 0.35
    bsdf.inputs['Subsurface Weight'].default_value = 0.12
    bsdf.inputs['Subsurface Scale'].default_value = 0.003
    nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    for tag in ('L', 'R'):
        o = bpy.data.objects.get(f'Eye_ball_{tag}')
        if o:
            o.data.materials.clear()
            o.data.materials.append(mat_eye)

    # --- C. GLOSSY TRANSPARENT CORNEA (Zero Shadow Block, Crisp Catchlight!) ---
    mat_cornea = bpy.data.materials.get('Human_Cornea_Mat') or bpy.data.materials.new('Human_Cornea_Mat')
    mat_cornea.use_nodes = True
    nt = mat_cornea.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    gloss = nt.nodes.new('ShaderNodeBsdfGlossy')
    gloss.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    gloss.inputs['Roughness'].default_value = 0.015
    fresnel = nt.nodes.new('ShaderNodeFresnel')
    fresnel.inputs['IOR'].default_value = 1.38
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix1 = nt.nodes.new('ShaderNodeMixShader')
    mix2 = nt.nodes.new('ShaderNodeMixShader')
    # Multiply fresnel by 0.65 so iris stays rich & crisp while key light creates lifelike catchlight
    math_m = nt.nodes.new('ShaderNodeMath')
    math_m.operation = 'MULTIPLY'
    math_m.inputs[1].default_value = 0.72
    nt.links.new(fresnel.outputs['Fac'], math_m.inputs[0])
    nt.links.new(math_m.outputs['Value'], mix1.inputs['Fac'])
    nt.links.new(trans.outputs['BSDF'], mix1.inputs[1])
    nt.links.new(gloss.outputs['BSDF'], mix1.inputs[2])
    # Shadow rays pass 100% transparently through cornea!
    nt.links.new(lp.outputs['Is Shadow Ray'], mix2.inputs['Fac'])
    nt.links.new(mix1.outputs['Shader'], mix2.inputs[1])
    nt.links.new(trans.outputs['BSDF'], mix2.inputs[2])
    nt.links.new(mix2.outputs['Shader'], out.inputs['Surface'])

    for tag in ('L', 'R'):
        for prefix in ('Eye_cornea_', 'Eye_tearline_'):
            o = bpy.data.objects.get(f'{prefix}{tag}')
            if o:
                o.data.materials.clear()
                o.data.materials.append(mat_cornea)

    # --- D. CARUNCLE MATERIAL ---
    mat_car = bpy.data.materials.get('Human_Caruncle_Mat') or bpy.data.materials.new('Human_Caruncle_Mat')
    mat_car.use_nodes = True
    nt = mat_car.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.42, 0.16, 0.14, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.16
    bsdf.inputs['Subsurface Weight'].default_value = 0.25
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    for tag in ('L', 'R'):
        o = bpy.data.objects.get(f'Eye_caruncle_{tag}')
        if o:
            o.data.materials.clear()
            o.data.materials.append(mat_car)

    # --- E. PHYSICALLY-BASED CYCLES PRINCIPLED HAIR BSDF (Natural Dark-Brown/Black Silky Hair!) ---
    mh_phys = bpy.data.materials.get('Cycles_Hair_Principled') or bpy.data.materials.new('Cycles_Hair_Principled')
    mh_phys.use_nodes = True
    nt = mh_phys.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hbsdf = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    hbsdf.parametrization = 'MELANIN'
    hbsdf.inputs['Melanin'].default_value = 0.935         # rich natural East Asian black / deep dark-brown
    hbsdf.inputs['Melanin Redness'].default_value = 0.16  # subtle natural warm sheen (not reddish-brown!)
    hbsdf.inputs['Roughness'].default_value = 0.36
    hbsdf.inputs['Radial Roughness'].default_value = 0.45
    hbsdf.inputs['Coat'].default_value = 0.10
    hbsdf.inputs['IOR'].default_value = 1.55
    hbsdf.inputs['Random Color'].default_value = 0.14
    hbsdf.inputs['Random Roughness'].default_value = 0.25
    nt.links.new(hbsdf.outputs['BSDF'], out.inputs['Surface'])

    # Slightly darker root-toned variant for brows & lashes
    mh_brow = bpy.data.materials.get('Cycles_Brow_Principled') or bpy.data.materials.new('Cycles_Brow_Principled')
    mh_brow.use_nodes = True
    nt = mh_brow.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hbsdf2 = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    hbsdf2.parametrization = 'MELANIN'
    hbsdf2.inputs['Melanin'].default_value = 0.93
    hbsdf2.inputs['Melanin Redness'].default_value = 0.18
    hbsdf2.inputs['Roughness'].default_value = 0.42
    hbsdf2.inputs['Radial Roughness'].default_value = 0.48
    hbsdf2.inputs['Coat'].default_value = 0.06
    hbsdf2.inputs['Random Color'].default_value = 0.12
    nt.links.new(hbsdf2.outputs['BSDF'], out.inputs['Surface'])

    # Matte scalp underbase (zero shine!)
    ms = bpy.data.materials.get('Scalp_Underbase_Mat') or bpy.data.materials.new('Scalp_Underbase_Mat')
    ms.use_nodes = True
    nt = ms.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.010, 0.008, 0.007, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.88
    bsdf.inputs['Specular IOR Level'].default_value = 0.05
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])


# =============================================================================
# 6. HAIRLINE + EYEBROWS + EYELASHES + 3-LAYER VOLUMINOUS SAMURAI HAIR GROOM
# =============================================================================
# Soft, organic rounded-squared masculine hairline (ZERO harsh 90-deg temple corners!)
HL_THETA = [0, 14, 24, 34, 43, 52, 61, 69, 75, 80, 86, 102, 110, 117, 125, 145, 180]
HL_Z = [
    HAIRLINE_Z - 0.0020,   # 0 deg: soft organic central widow's peak softness (1.7125)
    HAIRLINE_Z + 0.0004,   # 14 deg: gentle arch
    HAIRLINE_Z - 0.0018,   # 24 deg: smooth rounded-masculine turn
    HAIRLINE_Z - 0.0095,   # 34 deg: organic curving temple (no hard box corner!)
    1.693,                 # 43 deg: upper temple
    1.672,                 # 52 deg: mid temple
    1.648,                 # 61 deg: sideburn top
    1.624,                 # 69 deg: soft tapered sideburn
    1.635,                 # 75 deg: tuck cleanly in front of ear
    1.669,                 # 80 deg: clear cleanly over ear root
    1.678,                 # 86 deg: clear cleanly over ear top helix
    1.674,                 # 102 deg: behind ear top
    1.646,                 # 110 deg: behind ear mid
    1.608,                 # 117 deg: behind ear base
    1.594,                 # 125 deg: nape corner
    1.590,                 # 145 deg: occipital ridge
    1.589,                 # 180 deg: nape center
]


def hairline_z_at(theta_deg):
    return np.interp(theta_deg, HL_THETA, HL_Z)


def make_ribbon_mesh(name, strands, mats, rig):
    """Build ribbon hair card mesh from list of (pts Nx3, nrm Nx3, w_root, w_tip, mat_idx)."""
    old = bpy.data.objects.get(name)
    if old:
        me_old = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if me_old and me_old.users == 0:
            bpy.data.meshes.remove(me_old)

    nv = sum(len(s[0]) for s in strands) * 2
    V = np.empty((nv, 3), dtype=np.float64)
    UVv = np.empty((nv, 2), dtype=np.float32)
    F_list = []
    M_list = []
    a = 0
    for pts, nrm, w0, w1, mat_i in strands:
        n = len(pts)
        tan = np.gradient(pts, axis=0)
        side = np.cross(tan, nrm)
        sn = np.linalg.norm(side, axis=1)
        # Fallback if tangent aligns with normal
        bad = sn < 1e-7
        if np.any(bad):
            side[bad] = np.cross(tan[bad], np.array([1.0, 0.0, 0.0]))
            sn = np.linalg.norm(side, axis=1)
        side /= np.maximum(sn, 1e-9)[:, None]
        t = np.linspace(0.0, 1.0, n)
        w = (w0 + (w1 - w0) * (t ** 1.25))[:, None] * 0.5
        V[a:a + 2 * n:2] = pts - side * w
        V[a + 1:a + 2 * n:2] = pts + side * w
        UVv[a:a + 2 * n:2, 0] = 0.0
        UVv[a + 1:a + 2 * n:2, 0] = 1.0
        UVv[a:a + 2 * n:2, 1] = t
        UVv[a + 1:a + 2 * n:2, 1] = t
        k = np.arange(n - 1, dtype=np.int32) * 2 + a
        F_list.append(np.stack([k, k + 2, k + 3, k + 1], axis=1))
        M_list.append(np.full(n - 1, mat_i, dtype=np.int32))
        a += 2 * n

    F = np.concatenate(F_list)
    M = np.concatenate(M_list)
    uv = UVv[F.ravel()]
    nf = len(F)

    me = bpy.data.meshes.new(name)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', V.ravel())
    me.loops.add(nf * 4)
    me.loops.foreach_set('vertex_index', F.ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set('loop_start', np.arange(0, nf * 4, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(nf, 4, dtype=np.int32))
    me.update(calc_edges=True)
    for mn in mats:
        me.materials.append(bpy.data.materials[mn])
    me.polygons.foreach_set('material_index', M)
    lay = me.uv_layers.new(name='UVMap')
    lay.data.foreach_set('uv', uv.ravel())
    me.polygons.foreach_set('use_smooth', np.ones(nf, dtype=bool))
    me.validate()
    me.update()

    ob = bpy.data.objects.new(name, me)
    link_to_rig(ob, rig, {'head': 1.0})
    return ob


def make_hair_curves(name, curves_pts, r_root, r_tip, mat_name, rig):
    """Build native Blender 5.2 Hair Curves (CURVES) with per-point tapered radius & Principled Hair BSDF."""
    old = bpy.data.objects.get(name)
    if old:
        data_old = old.data
        ot = old.type
        bpy.data.objects.remove(old, do_unlink=True)
        if data_old and data_old.users == 0:
            if ot == 'CURVES':
                bpy.data.hair_curves.remove(data_old)
            elif ot == 'MESH':
                bpy.data.meshes.remove(data_old)

    sizes = [len(p) for p in curves_pts]
    n_pts = sum(sizes)
    pos = np.empty((n_pts, 3), dtype=np.float32)
    rad = np.empty(n_pts, dtype=np.float32)
    a = 0
    for p in curves_pts:
        n = len(p)
        pos[a:a + n] = p
        t = np.linspace(0.0, 1.0, n, dtype=np.float32)
        rad[a:a + n] = r_root + (r_tip - r_root) * (t ** 1.15)
        a += n

    hc = bpy.data.hair_curves.new(name)
    hc.add_curves(sizes)
    hc.attributes['position'].data.foreach_set('vector', pos.ravel())
    r_attr = hc.attributes.get('radius') or hc.attributes.new(name='radius', type='FLOAT', domain='POINT')
    r_attr.data.foreach_set('value', rad)
    hc.materials.append(bpy.data.materials[mat_name])

    ob = bpy.data.objects.new(name, hc)
    for col in rig.users_collection:
        if ob.name not in col.objects:
            col.objects.link(ob)

    # Parent cleanly to the 'head' bone while preserving exact world-space rest coordinates!
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = 'head'
    head_bone = rig.data.bones['head']
    ob.matrix_parent_inverse = (rig.matrix_world @ Matrix.Translation(head_bone.tail_local)).inverted()
    ob.matrix_world = Matrix.Identity(4)
    return ob


def smooth_poly(p, it=2):
    p = p.copy()
    for _ in range(it):
        p[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
    return p


def catmull(ctrl, n):
    ctrl = np.asarray(ctrl, dtype=np.float64)
    P = np.vstack([2 * ctrl[0] - ctrl[1], ctrl, 2 * ctrl[-1] - ctrl[-2]])
    seg = len(ctrl) - 1
    out = []
    for t in np.linspace(0.0, seg, n):
        i = min(int(t), seg - 1)
        u = t - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.array(out)


def evaluated_bvh(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(deps)
    me = eo.to_mesh()
    verts = [eo.matrix_world @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    co = np.array([[v.x, v.y, v.z] for v in verts], dtype=np.float64)
    me.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in me.loop_triangles], dtype=np.int32)
    eo.to_mesh_clear()
    return bvh, co, tris


def build_brows_and_lashes(rig, face_obj, seed=11):
    rng = np.random.default_rng(seed)
    bvh, _, _ = evaluated_bvh(face_obj)

    # --- A. ULTRA-FINE NATURAL MASCULINE EAST ASIAN EYEBROWS (Native Cycles Hair Curves!) ---
    brow_curves = []
    for sg in (-1.0, 1.0):
        n_hairs = 1250
        for _ in range(n_hairs):
            u = rng.random()  # 0=inner head, 1=outer tail
            if (u < 0.07 or u > 0.93) and rng.random() > 0.50:
                continue
            ax = 0.0098 + u * 0.0472
            z_center = (BROW_Z - 0.0040) + 0.0034 * math.sin(math.pi * (u ** 0.80)) - 0.0032 * max(0.0, u - 0.68) ** 1.25 * 4.5
            half_h = 0.0044 * (1.0 - 0.64 * (u ** 1.65)) * (0.80 + 0.20 * math.sin(math.pi * min(1.0, u * 3.0)))
            # Soft Gaussian vertical density so edges of eyebrows feather naturally into skin!
            dv = np.clip(rng.normal(0.0, 0.52), -1.15, 1.15) * half_h
            z0 = z_center + dv

            hit, nrm, _, _ = bvh.ray_cast(Vector((sg * ax, -0.35, z0)), Vector((0.0, 1.0, 0.0)))
            if hit is None:
                continue

            ang_up = 0.72 * (1.0 - min(1.0, u * 2.3)) - 0.30 * (dv / max(half_h, 1e-4)) - 0.34 * max(0.0, u - 0.64)
            d_flow = Vector((sg * math.cos(ang_up), 0.0, math.sin(ang_up))).normalized()
            L = (0.0072 + 0.0038 * rng.random()) * (1.0 - 0.28 * (u ** 2))

            pts = []
            q = hit.copy()
            nq = nrm.normalized()
            for k in range(6):
                tk = k / 5.0
                lift = 0.00018 + 0.00105 * math.sin(math.pi * tk * 0.85)
                pts.append(q + nq * lift)
                t_dir = d_flow - nq * d_flow.dot(nq)
                if t_dir.length > 1e-7:
                    t_dir.normalize()
                    q2, n2, _, _ = bvh.find_nearest(q + t_dir * (L / 5.0))
                    q, nq = q2, n2.normalized()
            brow_curves.append(np.array(pts, dtype=np.float32))

    make_hair_curves('Hair_Eyebrows', brow_curves, 0.000095, 0.000018, 'Cycles_Brow_Principled', rig)

    # --- B. NATURAL CURVED UPPER & SPARSE LOWER EYELASHES (Native Cycles Hair Curves!) ---
    lash_curves = []
    for sg in (-1.0, 1.0):
        # Upper lashes: crisp natural masculine lash fringe
        for i in range(105):
            u = (i + rng.random() * 0.6) / 106.0
            ax = (EYE_X - EYE_HALF_W + 0.0015) + u * (2.0 * EYE_HALF_W - 0.0022)
            _, zu, _, _ = eye_curves(ax)
            y0 = float(eye_lid_y(ax, zu)) - 0.0005
            p0 = Vector((sg * ax, y0, zu))
            L = (0.0036 + 0.0022 * math.sin(math.pi * (u ** 0.72))) * (0.82 + 0.34 * rng.random())
            out_x = sg * (0.38 * (u - 0.32))
            pts = []
            for k in range(6):
                tk = k / 5.0
                p = p0 + Vector((out_x * L * tk, -L * tk * 0.88, L * (0.12 * tk + 0.42 * tk * tk)))
                pts.append(p)
            lash_curves.append(np.array(pts, dtype=np.float32))
        # Subtle sparse lower lashes along outer two-thirds
        for i in range(36):
            u = 0.18 + 0.76 * (i + rng.random() * 0.5) / 36.0
            ax = (EYE_X - EYE_HALF_W + 0.0016) + u * (2.0 * EYE_HALF_W - 0.0024)
            _, _, zl, _ = eye_curves(ax)
            y0 = float(eye_lid_y(ax, zl)) - 0.0003
            p0 = Vector((sg * ax, y0, zl))
            L = (0.0018 + 0.0011 * math.sin(math.pi * u)) * (0.8 + 0.4 * rng.random())
            pts = []
            for k in range(5):
                tk = k / 4.0
                p = p0 + Vector((sg * 0.25 * L * tk, -L * tk * 0.75, -L * (0.35 * tk + 0.25 * tk * tk)))
                pts.append(p)
            lash_curves.append(np.array(pts, dtype=np.float32))

    make_hair_curves('Hair_Eyelashes', lash_curves, 0.000072, 0.000014, 'Cycles_Brow_Principled', rig)
    print(f"Built native Hair Curves: brows ({len(brow_curves)} strands) & lashes ({len(lash_curves)} strands)")


def build_hair_groom(rig, face_obj, n_main=36000, n_bun=6500, n_baby=2800, seed=19):
    """Photorealistic 3-layer native Blender Hair Curves groom with Principled Hair BSDF.

    Every scalp strand is rooted directly inside the scalp skin (zero floating plug rows!)
    and arches smoothly outward into lush, naturally clumped East Asian hair bulk.
    """
    t0 = time.time()
    rng = np.random.default_rng(seed)
    random.seed(seed)

    bpy.context.scene.render.hair_type = 'STRIP'
    bpy.context.scene.render.hair_subdiv = 0
    if hasattr(bpy.context.scene.cycles, 'curves_shape'):
        bpy.context.scene.cycles.curves_shape = 'RIBBON'

    bvh, fco, tris = evaluated_bvh(face_obj)
    A, B_, C_ = fco[tris[:, 0]], fco[tris[:, 1]], fco[tris[:, 2]]
    cen = (A + B_ + C_) / 3.0
    th = np.degrees(np.arctan2(np.abs(cen[:, 0]), -cen[:, 1]))
    area = 0.5 * np.linalg.norm(np.cross(B_ - A, C_ - A), axis=1)

    # ---- LAYER 1: SCALP EMITTER & RECESSED MATTE UNDERBASE ----
    inside = (cen[:, 2] >= hairline_z_at(th) - 0.004) & (cen[:, 2] > 1.56)
    sel = np.where(inside)[0]

    # Matte dark underbase recessed 11 mm inside front hairline so front hairline is 100% organic strands!
    front_inset = np.where(th[sel] < 78.0, 0.0110, 0.0055)
    under = sel[cen[sel, 2] >= hairline_z_at(th[sel]) + front_inset]
    vidx = np.unique(tris[under])
    remap = -np.ones(len(fco), dtype=np.int32)
    remap[vidx] = np.arange(len(vidx), dtype=np.int32)
    fnorm = np.zeros_like(fco)
    tn = np.cross(B_ - A, C_ - A)
    for j in range(3):
        np.add.at(fnorm, tris[:, j], tn)
    fnorm /= np.maximum(np.linalg.norm(fnorm, axis=1), 1e-12)[:, None]

    U_co = fco[vidx] + fnorm[vidx] * 0.0006
    U_F = remap[tris[under]]
    old_u = bpy.data.objects.get('Scalp_emitter_underbase')
    if old_u:
        me_o = old_u.data
        bpy.data.objects.remove(old_u, do_unlink=True)
        if me_o and me_o.users == 0:
            bpy.data.meshes.remove(me_o)
    me_u = bpy.data.meshes.new('Scalp_emitter_underbase')
    me_u.from_pydata(U_co.tolist(), [], U_F.tolist())
    me_u.materials.append(bpy.data.materials['Scalp_Underbase_Mat'])
    me_u.polygons.foreach_set('use_smooth', np.ones(len(me_u.polygons), dtype=bool))
    me_u.update()
    ob_u = bpy.data.objects.new('Scalp_emitter_underbase', me_u)
    link_to_rig(ob_u, rig, {'head': 1.0})

    # ---- UPPER-CROWN TOPKNOT ANCHOR (~64 deg elevation on upper crown!) ----
    ear_line_z = 0.5 * (BROW_Z + NOSE_BASE_Z)
    ray_dir = Vector((0.0, math.cos(math.radians(64.0)), math.sin(math.radians(64.0)))).normalized()
    hit, nB_v, _, _ = bvh.ray_cast(Vector((0.0, 0.005, ear_line_z)), ray_dir)
    Bp = np.array(hit, dtype=np.float64)
    nB = np.array(nB_v, dtype=np.float64)
    nB /= np.linalg.norm(nB)
    if nB @ (Bp - np.array([0.0, 0.005, ear_line_z])) < 0.0:
        nB = -nB
    nB = 0.45 * nB + 0.55 * np.array(ray_dir)
    nB /= np.linalg.norm(nB)

    rb = BUN_DIAM * 0.45
    ra = rb * 0.85
    tie_base = Bp + nB * 0.0110
    tie_h = 0.0095
    tie_r = 0.0160
    bun_c = tie_base + nB * (tie_h * 0.48 + ra * 0.90)
    print(f"Topknot anchor={np.round(Bp, 4)}, normal={np.round(nB, 3)}, center={np.round(bun_c, 4)}")

    # ---- LAYER 2: 36,000 NATURALLY ROOTED, SMOOTHLY ARCHED SCALP STRANDS ----
    # Higher guide density (3,600 guides) with extra density along the front hairline
    # so roots distribute seamlessly with ZERO plug/tuft gaps!
    n_guides = 3600
    Bv = Vector(Bp)
    gather = tie_r + 0.0045
    up = Vector((0.0, 0.0, 1.0))
    ear_c_L = Vector((0.075, 0.012, ear_line_z))
    ear_c_R = Vector((-0.075, 0.012, ear_line_z))

    # Boost sampling probability slightly near the front hairline for silky seamless transition!
    hl_dist = cen[sel, 2] - hairline_z_at(th[sel])
    wt = area[sel] * (1.0 + 1.8 * np.exp(-(np.maximum(hl_dist, 0.0) / 0.016) ** 2) * (th[sel] < 80.0))
    g_pick = rng.choice(sel, size=int(n_guides * 1.9), p=wt / wt.sum())
    r1 = rng.random(len(g_pick))
    r2 = rng.random(len(g_pick))
    sq = np.sqrt(r1)
    g_roots = ((1.0 - sq)[:, None] * A[g_pick]
               + (sq * (1.0 - r2))[:, None] * B_[g_pick]
               + (sq * r2)[:, None] * C_[g_pick])
    g_th = np.degrees(np.arctan2(np.abs(g_roots[:, 0]), -g_roots[:, 1]))
    g_depth = g_roots[:, 2] - (hairline_z_at(g_th) + rng.normal(0.0, 0.0028, len(g_roots)))
    g_keep = (g_depth > 0.0) & (rng.random(len(g_roots)) < np.clip(0.20 + 0.80 * g_depth / 0.011, 0.20, 1.0))
    g_roots = g_roots[g_keep][:n_guides]
    g_depth = g_depth[g_keep][:n_guides]
    g_th = g_th[g_keep][:n_guides]

    N_SEG = 24
    guides_pts = []
    guides_nrm = []
    guides_depth_list = []

    for i, r in enumerate(g_roots):
        p = Vector(r)
        q, nq, _, _ = bvh.find_nearest(p)
        nq.normalize()
        d0 = max((q - Bv).length, 1e-4)

        front_crown_boost = 1.0 + 0.90 * max(0.0, 1.0 - g_th[i] / 110.0)
        hair_vol = (0.0052 + 0.0068 * (rng.random() ** 0.72)) * front_crown_boost

        # CRITICAL: EVERY hair root starts cleanly EMBEDDED inside the scalp (-0.6 mm)!
        # ZERO floating bristle step anywhere on the head!
        pts = [q - nq * 0.0006]
        nrms = [nq.copy()]
        dprev = None
        for step in range(95):
            v = Bv - q
            t = v - nq * v.dot(nq)
            for ec in (ear_c_L, ear_c_R):
                e = q - ec
                if abs(e.y) < 0.042 and q.z < BROW_Z + 0.022 and abs(q.x) > 0.052 and e.length < 0.056:
                    t += (up - nq * up.dot(nq)) * (0.048 * (1.0 - e.length / 0.056))
            if t.length < 1e-9:
                break
            t.normalize()
            if dprev is not None:
                t = (dprev * 0.62 + t * 0.38).normalized()
            dprev = t

            q2, n2, _, _ = bvh.find_nearest(q + t * 0.0036)
            q, nq = q2, n2.normalized()
            arc_mm = (step + 1) * 3.6  # distance traveled from root in mm
            prog = 1.0 - min(1.0, (q - Bv).length / d0)
            # Smooth natural hair root emergence: emerges cleanly out of skin over first ~18 mm,
            # builds lush soft crown volume across mid-scalp, then cinches smoothly into the hair-tie!
            emerge = float(ss(0.0, 18.0, arc_mm))
            arch = math.sin(math.pi * min(1.0, prog * 0.92 + 0.08)) ** 0.60
            lift = -0.0006 * (1.0 - emerge) + emerge * (hair_vol * arch + 0.0020 * prog)
            pts.append(q + nq * lift)
            nrms.append(nq.copy())
            if (q - Bv).length < gather:
                break

        radial = Vector(pts[-1]) - Bv
        radial -= Vector(nB) * radial.dot(Vector(nB))
        radial = radial.normalized() if radial.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        pts.append(Vector(tie_base) + Vector(nB) * 0.001 + radial * (tie_r * 0.94))
        nrms.append(radial)
        pts.append(Vector(tie_base) + Vector(nB) * 0.010 + radial * (tie_r * 0.72))
        nrms.append(radial)

        P = smooth_poly(np.array(pts, dtype=np.float64), 2)
        P[0] = pts[0]
        idx_f = np.linspace(0.0, len(P) - 1, N_SEG)
        i0 = np.floor(idx_f).astype(int)
        i1 = np.minimum(i0 + 1, len(P) - 1)
        fr = (idx_f - i0)[:, None]
        P_rs = P[i0] * (1.0 - fr) + P[i1] * fr
        N_arr = np.array(nrms, dtype=np.float64)
        N_rs = N_arr[i0] * (1.0 - fr) + N_arr[i1] * fr
        N_rs /= np.maximum(np.linalg.norm(N_rs, axis=1), 1e-9)[:, None]

        guides_pts.append(P_rs)
        guides_nrm.append(N_rs)
        guides_depth_list.append(g_depth[i])

    # Spawn silky child strands: roots spread smoothly across scalp (ZERO clumped root plugs!),
    # gently gathering into soft organic wisps along mid-shaft!
    scalp_curves = []
    t_par = np.linspace(0.0, 1.0, N_SEG)[:, None]
    t_mid_env = np.sin(np.pi * t_par) ** 0.85
    per_guide = max(1, n_main // len(guides_pts))

    for gi, (GP, GN) in enumerate(zip(guides_pts, guides_nrm)):
        tang = np.gradient(GP, axis=0)
        tang /= np.maximum(np.linalg.norm(tang, axis=1), 1e-9)[:, None]
        side = np.cross(tang, GN)
        side /= np.maximum(np.linalg.norm(side, axis=1), 1e-9)[:, None]

        for _ in range(per_guide):
            # Spread roots naturally horizontally along scalp (prevents discrete tuft spacing!)
            s_root = rng.normal(0.0, 0.0026)
            t_root_shift = rng.normal(0.0, 0.0022)
            # Soft natural clumping mid-length + subtle individual strand wave
            is_fly = (rng.random() < 0.032)
            lift_j = (rng.uniform(0.0022, 0.0050) if is_fly else rng.normal(0.0, 0.0014)) * t_mid_env
            wave_freq = rng.uniform(2.0, 4.0)
            wave_amp = rng.uniform(0.00025, 0.00080)
            phase = rng.random() * 2.0 * math.pi

            # Root offset blends down to soft clump mid-shaft -> pinches neatly at hair-tie
            spread_env = (1.0 - 0.72 * (t_par ** 0.75))
            off_s = s_root * spread_env + wave_amp * np.sin(wave_freq * math.pi * t_par + phase) * t_mid_env
            off_t = t_root_shift * (1.0 - t_par) ** 1.6
            C = GP + side * off_s + tang * off_t + GN * lift_j
            scalp_curves.append(C.astype(np.float32))

    # ---- SOFT LOW-DENSITY BABY HAIRS (Hairline, Temples, Sideburns & Nape — 5,000 ultra-fine strands!) ----
    baby_curves = []
    cand_nape = sel[(th[sel] > 106) & (np.abs(cen[sel, 2] - hairline_z_at(th[sel]) - 0.001) < 0.0065)]
    pick_b = rng.choice(cand_nape, size=n_baby, p=area[cand_nape] / area[cand_nape].sum())
    for j in pick_b:
        w = rng.random(3)
        w /= w.sum()
        p = Vector(w[0] * A[j] + w[1] * B_[j] + w[2] * C_[j])
        q, nq, _, _ = bvh.find_nearest(p)
        nq.normalize()
        L = 0.007 + rng.random() * 0.019
        down = Vector((-0.25 * np.sign(q.x) * rng.random(), 0.15, -1.0)).normalized()
        pts = [q - nq * 0.0003]
        for k in range(5):
            t = down - nq * down.dot(nq)
            if t.length < 1e-7:
                break
            t.normalize()
            q, nq, _, _ = bvh.find_nearest(q + t * (L / 5.0))
            nq.normalize()
            pts.append(q + nq * (0.0002 + 0.00035 * k))
        baby_curves.append(np.array(pts, dtype=np.float32))

    # Soft feathered baby hairs along forehead, temples & sideburns (blending smoothly into swept hair!)
    cand_front = sel[(th[sel] < 78) & (np.abs(cen[sel, 2] - hairline_z_at(th[sel]) + 0.001) < 0.0080)]
    if len(cand_front):
        pick_f = rng.choice(cand_front, size=2400, p=area[cand_front] / area[cand_front].sum())
        for j in pick_f:
            w = rng.random(3)
            w /= w.sum()
            p = Vector(w[0] * A[j] + w[1] * B_[j] + w[2] * C_[j])
            q, nq, _, _ = bvh.find_nearest(p)
            nq.normalize()
            L = 0.008 + rng.random() * 0.020
            if q.z < 1.662:
                v_dir = Vector((0.0, 0.45, -0.88)).normalized()
            else:
                v_dir = (Bv - q).normalized()
            pts = [q - nq * 0.0003]
            for k in range(6):
                t = v_dir - nq * v_dir.dot(nq)
                if t.length < 1e-7:
                    break
                t.normalize()
                q, nq, _, _ = bvh.find_nearest(q + t * (L / 6.0))
                nq.normalize()
                pts.append(q + nq * (0.00025 + 0.00055 * k))
            baby_curves.append(np.array(pts, dtype=np.float32))

    # ---- LAYER 3: NATURAL LOOSE FRAMING STRANDS (Gracefully framing cheeks & near ears!) ----
    def surf_pt(theta_deg, z, sg):
        d = Vector((sg * math.sin(math.radians(theta_deg)), -math.cos(math.radians(theta_deg)), 0.0))
        loc, n, _, _ = bvh.ray_cast(Vector((0.0, 0.0, z)), d)
        if loc is None:
            loc, n, _, _ = bvh.find_nearest(Vector((sg * 0.075, -0.05, z)))
        return np.array(loc), np.array(n.normalized())

    wisp_curves = []
    wisp_specs = [
        (1.0,  31.0, 46.0, 140, 1.556),
        (1.0,  44.0, 58.0, 100, 1.574),
        (1.0,  58.0, 68.0, 65,  1.590),
        (-1.0, 32.0, 47.0, 130, 1.560),
        (-1.0, 46.0, 59.0, 90,  1.578),
    ]
    for sg, th0, thc, nstr, z_end in wisp_specs:
        z0 = float(hairline_z_at(th0)) + 0.010
        c0, n0 = surf_pt(th0 + 3.0, z0, sg)
        c1, n1 = surf_pt(th0 + 7.0, z0 - 0.024, sg)
        c2, n2 = surf_pt(thc, 1.638, sg)
        c3, n3 = surf_pt(thc + 2.0, 1.600, sg)
        ctrl = [
            c0 - n0 * 0.0004,
            c1 + n1 * 0.0058,
            c2 + n2 * 0.0068,
            c3 + n3 * 0.0072,
            c3 + n3 * 0.0092 + np.array([sg * 0.0025, -0.005, z_end - 1.600]),
        ]
        spine = catmull(ctrl, 34)
        tang = np.gradient(spine, axis=0)
        tang /= np.maximum(np.linalg.norm(tang, axis=1), 1e-9)[:, None]
        for _ in range(nstr):
            ang = rng.random() * 2.0 * math.pi
            rad = 0.0034 * math.sqrt(rng.random())
            tend = 0.65 + 0.35 * rng.random()
            n_pt = max(12, int(34 * tend))
            sway = rng.normal(0.0, 0.0024, 3)
            pts = []
            for k in range(n_pt):
                t = k / 33.0
                tg = Vector(tang[k])
                ref = Vector((0.0, 0.0, 1.0)) if abs(tg.z) < 0.9 else Vector((1.0, 0.0, 0.0))
                b1 = tg.cross(ref).normalized()
                b2 = tg.cross(b1)
                spread = rad * ((1.0 - t) ** 0.65 + 0.22)
                p = Vector(spine[k]) + (b1 * math.cos(ang) + b2 * math.sin(ang)) * spread + Vector(sway) * math.sin(math.pi * t)
                if k > 0:
                    q, nq, _, _ = bvh.find_nearest(p)
                    nq.normalize()
                    if (p - q).dot(nq) < 0.0018:
                        p = q + nq * 0.0018
                pts.append(p)
            wisp_curves.append(np.array(pts, dtype=np.float32))

    # ---- NATURAL LAYERED COILED TOPKNOT BUN (6,500 dense silky individual strands!) ----
    z_ax = Vector(nB)
    x_ax = z_ax.cross(Vector((1.0, 0.0, 0.0))).normalized()
    y_ax = z_ax.cross(x_ax)
    Mb = np.array([x_ax, y_ax, z_ax]).T
    bun_curves = []
    for s_i in range(n_bun):
        rf = 0.72 + 0.30 * (rng.random() ** 0.55)
        n_pt = 28
        if rng.random() < 0.65:
            phi0 = rng.random() * 2.0 * math.pi
            turns = 0.85 + 0.80 * rng.random()
            a0, a1 = -1.05, 0.45 + 1.00 * rng.random()
            t = np.linspace(0.0, 1.0, n_pt)
            phi_c = phi0 + turns * 2.0 * math.pi * t
            al = a0 + (a1 - a0) * (t ** 0.85)
            loc = np.stack([rb * np.cos(al) * np.cos(phi_c),
                            rb * np.cos(al) * np.sin(phi_c),
                            ra * np.sin(al)], axis=1)
            loc *= (1.0 + 0.12 * np.sin(2.0 * phi_c - 3.5 * al + 0.4 * (s_i % 5)))[:, None]
        else:
            ax_v = rng.normal(0.0, 1.0, 3)
            ax_v[2] *= 0.35
            ax_v /= np.linalg.norm(ax_v)
            u_v = np.cross(ax_v, [0.0, 0.0, 1.0])
            u_v /= np.linalg.norm(u_v)
            v_v = np.cross(ax_v, u_v)
            t0_ = rng.random() * 2.0 * math.pi
            t = t0_ + np.linspace(0.0, math.pi * (1.05 + 0.55 * rng.random()), n_pt)
            d = np.cos(t)[:, None] * u_v + np.sin(t)[:, None] * v_v
            d[:, 2] = np.maximum(d[:, 2], -0.82)
            d /= np.linalg.norm(d, axis=1)[:, None]
            loc = d * np.array([rb, rb, ra])

        loc *= rf * (1.0 + 0.06 * np.sin(np.linspace(0.0, 8.0, n_pt) + s_i))[:, None]
        P = bun_c + loc @ Mb.T
        bun_curves.append(P.astype(np.float32))

    # Ultra-fine silky human hair radii!
    make_hair_curves('Hair_Scalp_Groom', scalp_curves, 0.000105, 0.000042, 'Cycles_Hair_Principled', rig)
    print(f"  Hair_Scalp_Groom: {len(scalp_curves)} curves ({time.time()-t0:.1f}s)")
    make_hair_curves('Hair_Baby_Hairs', baby_curves, 0.000055, 0.000012, 'Cycles_Hair_Principled', rig)
    print(f"  Hair_Baby_Hairs: {len(baby_curves)} curves ({time.time()-t0:.1f}s)")
    make_hair_curves('Hair_Framing_Wisps', wisp_curves, 0.000075, 0.000015, 'Cycles_Hair_Principled', rig)
    print(f"  Hair_Framing_Wisps: {len(wisp_curves)} curves ({time.time()-t0:.1f}s)")
    make_hair_curves('Hair_Topknot_Bun', bun_curves, 0.000125, 0.000055, 'Cycles_Hair_Principled', rig)
    print(f"  Hair_Topknot_Bun: {len(bun_curves)} curves ({time.time()-t0:.1f}s)")

    # Wrapped dark hair-tie band at the base of the topknot
    turns, sides, steps, cr = 3.2, 8, 200, 0.0020
    tt = np.linspace(0.0, 1.0, steps)
    ang = tt * turns * 2.0 * math.pi
    centre = (tie_base + np.outer(0.001 + tt * (tie_h - 0.002), nB)
              + tie_r * (np.outer(np.cos(ang), x_ax) + np.outer(np.sin(ang), y_ax)))
    tan = np.gradient(centre, axis=0)
    tan /= np.maximum(np.linalg.norm(tan, axis=1), 1e-9)[:, None]
    nrm = np.cross(tan, nB)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-9)[:, None]
    bin_ = np.cross(tan, nrm)
    V_t = []
    F_t = []
    for i in range(steps):
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            V_t.append(centre[i] + cr * (math.cos(a) * nrm[i] + math.sin(a) * bin_[i]))
    for i in range(steps - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            F_t.append([a, b, b + sides, a + sides])

    old_t = bpy.data.objects.get('Hair_tie_band')
    if old_t:
        me_o = old_t.data
        bpy.data.objects.remove(old_t, do_unlink=True)
        if me_o and me_o.users == 0:
            bpy.data.meshes.remove(me_o)
    me_t = bpy.data.meshes.new('Hair_tie_band')
    me_t.from_pydata([v.tolist() for v in V_t], [], F_t)
    me_t.materials.append(bpy.data.materials['Dark crimson cord'])
    me_t.polygons.foreach_set('use_smooth', np.ones(len(me_t.polygons), dtype=bool))
    me_t.update()
    ob_t = bpy.data.objects.new('Hair_tie_band', me_t)
    link_to_rig(ob_t, rig, {'head': 1.0})

    face_obj['groom_bun'] = [float(v) for v in list(bun_c) + list(nB)]
    print(f"Native Hair Curves groom complete in {time.time()-t0:.1f}s")


# =============================================================================
# 7. STUDIO PORTRAIT LIGHTING TUNING (Clean Soft 3/4 Key + Cool Fill + Rim)
# =============================================================================
def tune_portrait_lighting():
    # Soft cinematic portrait lighting (smooth shadows across face & dark navy collar, zero harsh backlighting!)
    # Large softbox key from upper front-left (character's right-front) modeling cheekbones, nose bridge & forehead!
    key = bpy.data.objects.get('Cinematic_Key')
    if key and key.type == 'LIGHT':
        key.location = Vector((-1.40, -1.55, 2.20))
        key.rotation_euler = (Vector((0.0, 0.0, 1.62)) - key.location).to_track_quat('-Z', 'Y').to_euler()
        key.data.energy = 88.0
        key.data.size = 1.65
        key.data.color = (1.0, 0.96, 0.91)

    # Soft cool fill keeping smooth shadow gradation across the far cheek and navy collar
    fill = bpy.data.objects.get('Cinematic_Fill')
    if fill and fill.type == 'LIGHT':
        fill.location = Vector((1.65, -1.25, 1.68))
        fill.rotation_euler = (Vector((0.0, 0.0, 1.60)) - fill.location).to_track_quat('-Z', 'Y').to_euler()
        fill.data.energy = 11.5
        fill.data.size = 2.4
        fill.data.color = (0.86, 0.92, 1.0)

    # Gentle restrained hair-separation rim light (soft, NEVER artificial harsh backlighting!)
    rim = bpy.data.objects.get('Cinematic_Rim')
    if rim and rim.type == 'LIGHT':
        rim.location = Vector((0.85, 1.35, 2.30))
        rim.rotation_euler = (Vector((0.0, 0.0, 1.68)) - rim.location).to_track_quat('-Z', 'Y').to_euler()
        rim.data.energy = 18.0
        rim.data.size = 1.6
        rim.data.color = (0.95, 0.97, 1.0)

    # Consistent neutral dark gray studio background
    world = bpy.context.scene.world
    if world and world.use_nodes:
        for n in world.node_tree.nodes:
            if n.type == 'BACKGROUND' and not n.inputs[0].is_linked:
                n.inputs[0].default_value = (0.088, 0.091, 0.097, 1.0)
                n.inputs[1].default_value = 1.0


def render_cinematic_closeup(samples=96, res_x=1024, res_y=1024):
    """Render a cinematic close-up 3/4 Cycles portrait looking slightly to the right."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    # Enable GPU (OptiX / CUDA) when available for fast high-sample rendering
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = dt
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == dt]
            if gpus:
                for d in prefs.devices:
                    d.use = (d.type == dt)
                scene.cycles.device = 'GPU'
                break
        except Exception:
            pass
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    if hasattr(scene.cycles, 'curves_shape'):
        scene.cycles.curves_shape = 'RIBBON'
    scene.render.hair_type = 'STRIP'
    scene.render.hair_subdiv = 0
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    scene.view_settings.exposure = 0.15

    # Create / update dedicated 85mm portrait camera (3/4 view looking slightly right!)
    cam_ob = bpy.data.objects.get('Cinematic_Closeup_Cam')
    if not cam_ob:
        cam_data = bpy.data.cameras.new('Cinematic_Closeup_Cam')
        cam_ob = bpy.data.objects.new('Cinematic_Closeup_Cam', cam_data)
        scene.collection.objects.link(cam_ob)
    cam_ob.data.type = 'PERSP'
    cam_ob.data.lens = 85.0
    cam_ob.data.sensor_width = 36.0
    # Position camera at front-left of scene so character faces slightly toward the right of frame!
    target = Vector((0.005, -0.015, 1.635))
    cam_loc = target + Vector((-0.56, -1.00, 0.055)).normalized() * 0.94
    cam_ob.location = cam_loc
    cam_ob.rotation_euler = (target - cam_loc).to_track_quat('-Z', 'Y').to_euler()
    # Crisp natural portrait depth of field (f/8 keeps face, framing wisps & topknot sharp!)
    cam_ob.data.dof.use_dof = True
    cam_ob.data.dof.focus_distance = (Vector((0.0, -0.10, EYE_Z)) - cam_loc).length
    cam_ob.data.dof.aperture_fstop = 8.0

    prev_cam = scene.camera
    scene.camera = cam_ob
    out_path = OUT / 'samurai_cinematic_closeup.png'
    scene.render.filepath = str(out_path)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    scene.camera = prev_cam
    print(f"Rendered cinematic close-up to {out_path} in {time.time()-t0:.1f}s")
    return out_path


# =============================================================================
# 8. LANDMARK VERIFICATION & SAVE / EXPORT
# =============================================================================
def report_landmarks():
    face = bpy.data.objects['head__Face_warm_skin']
    _, P, _ = evaluated_bvh(face)
    front = P[(np.abs(P[:, 0]) < 0.012) & (P[:, 1] < -0.08)]
    chin = float(front[:, 2].min())
    top = float(P[:, 2].max())
    Hm = top - chin

    def width_at(z0, band=0.0025):
        sl = P[np.abs(P[:, 2] - z0) < band]
        return float(np.abs(sl[:, 0]).max() * 2.0) if len(sl) else 0.0

    cheek_w = max(width_at(z) for z in np.arange(1.622, 1.646, 0.002))
    eye_line_w = width_at(EYE_Z)
    jaw_w = width_at(MOUTH_Z)
    neck_w = width_at(1.505)

    ear = bpy.data.objects.get('Ear_L')
    ear_str = 'none'
    if ear:
        eco = np.array([v.co for v in ear.data.vertices])
        ear_str = f"{eco[:,2].min():.4f}..{eco[:,2].max():.4f} (H={(eco[:,2].max()-eco[:,2].min())*100:.2f} cm)"

    print("\n================ ANATOMICAL VERIFICATION ================")
    print(f"Total Head Height H          : {Hm*100:.2f} cm  (target 23.00 cm)")
    print(f"Head Width @ cheekbones      : {cheek_w*100:.2f} cm = {cheek_w/Hm:.3f} H  (target 0.700 H)")
    print(f"Eye Line Vertical            : {EYE_Z:.4f} m = {(EYE_Z-chin)/Hm:.3f} H from chin  (target 0.500 H)")
    print(f"Eye Width & Spacing          : {2*EYE_HALF_W*100:.2f} cm, gap={(2*(EYE_X-EYE_HALF_W))*100:.2f} cm ({(EYE_X-EYE_HALF_W)/EYE_HALF_W:.2f}x), across={eye_line_w/(2*EYE_HALF_W):.2f} eyes")
    print(f"Facial Thirds                : Upper {(HAIRLINE_Z-BROW_Z)*100:.2f} cm | Mid {(BROW_Z-NOSE_BASE_Z)*100:.2f} cm | Lower {(NOSE_BASE_Z-chin)*100:.2f} cm")
    print(f"Ears (brow..nose)            : {ear_str}  (target {NOSE_BASE_Z:.4f}..{BROW_Z:.4f})")
    print(f"Jaw Width @ mouth            : {jaw_w*100:.2f} cm = {jaw_w/cheek_w:.3f} x cheek  (target 0.75-0.80)")
    print(f"Neck Width                   : {neck_w*100:.2f} cm = {neck_w/jaw_w:.3f} x jaw  (target 0.80-0.85)")
    print(f"Front Hairline               : {HAIRLINE_Z:.4f} m = {(top-HAIRLINE_Z)/Hm:.3f} H below top  (target 0.150 H)")
    tk = bpy.data.objects.get('Hair_Topknot_Bun') or bpy.data.objects.get('Topknot_coils')
    if tk and face.get('groom_bun'):
        bun = face['groom_bun']
        c = np.array(bun[:3])
        n = np.array(bun[3:])
        if tk.type == 'CURVES':
            npts = len(tk.data.points)
            tco = np.empty(npts * 3)
            tk.data.attributes['position'].data.foreach_get('vector', tco)
        else:
            tco = np.empty(len(tk.data.vertices) * 3)
            tk.data.vertices.foreach_get('co', tco)
        tco = tco.reshape(-1, 3)
        rel = tco - c
        rad = rel - np.outer(rel @ n, n)
        d = 2.0 * np.linalg.norm(rad, axis=1).max()
        print(f"Topknot Diameter             : {d*100:.2f} cm = {d/Hm:.3f} H  (target 0.25-0.30 H)")
    print("=========================================================\n")


def save_and_export():
    rig = bpy.data.objects['Samurai_Rig']
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for ob in rig.children:
        if ob.type == 'MESH':
            ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / 'samurai_character.glb'),
        export_format='GLB',
        use_selection=True,
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_draco_mesh_compression_enable=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'samurai_character.blend'))
    print("Saved samurai_character.blend and exported samurai_character.glb")


def run(stage='all'):
    rig = bpy.data.objects['Samurai_Rig']
    if stage in ('face', 'all'):
        remove_old_head_objects(rig)
        face_obj = build_head_and_neck(rig)
        build_eyes(rig)
        build_ears(rig, face_obj)
        setup_materials(face_obj)
        tune_portrait_lighting()
    face_obj = bpy.data.objects['head__Face_warm_skin']
    if stage in ('hair', 'all'):
        build_brows_and_lashes(rig, face_obj)
        build_hair_groom(rig, face_obj)
    if stage in ('report', 'face', 'hair', 'all'):
        report_landmarks()
    if stage in ('render', 'all_render'):
        render_cinematic_closeup()
    if stage == 'save':
        save_and_export()


if __name__ == '__main__' or 'STAGE' in globals():
    run(globals().get('STAGE', 'all'))
