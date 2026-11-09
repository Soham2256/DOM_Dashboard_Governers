"""
Governor 3D Simulation using Matplotlib (Python)
Generates upright 3D kinematic visualizations, multi-speed comparisons,
and animated 3D GIF simulations for Watt, Porter, Proell, and Hartnell governors.

Can be used both:
  1. Via Web Dashboard API (app.py -> /api/matplotlib_sim)
  2. Standalone CLI: python simulate_3d.py [watt|porter|proell|hartnell|all]
"""

import io
import os
import sys
import base64
import tempfile
import threading
import numpy as np
import matplotlib
matplotlib.use('Agg')
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
import matplotlib.animation as animation

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
G = 9.81
_MATPLOTLIB_LOCK = threading.Lock()


# ──────────────────────────────────────────────
#  Kinematics & Physics Helper Functions
# ──────────────────────────────────────────────

def _safe_float(d, key, default):
    try:
        val = float(d.get(key, default))
        return val if np.isfinite(val) else default
    except (TypeError, ValueError):
        return default


def solve_watt_state(N, params):
    m = max(0.05, _safe_float(params, 'ball_mass', 2.0))
    L = max(0.05, _safe_float(params, 'arm_length', 0.3))
    omega = 2.0 * np.pi * N / 60.0
    h = min(G / (omega ** 2), L) if omega > 0 else L
    r = float(np.sqrt(max(0.0, L ** 2 - h ** 2)))
    Fc = m * (omega ** 2) * r
    return {
        'N': N, 'omega': omega, 'h': h, 'r': r, 'Fc': Fc,
        'L': L, 'm': m, 'lifted': h < L - 1e-6
    }


def solve_porter_state(N, params):
    m = max(0.05, _safe_float(params, 'ball_mass', 2.0))
    M = max(0.0, _safe_float(params, 'sleeve_mass', 5.0))
    L = max(0.05, _safe_float(params, 'arm_length', 0.3))
    l = max(0.05, _safe_float(params, 'link_length', 0.3))
    q = max(0.05, _safe_float(params, 'q', 1.0))
    omega = 2.0 * np.pi * N / 60.0
    factor = (m + M * (1.0 + q)) / m
    h = min(factor * G / (omega ** 2), L) if omega > 0 else L
    r = float(np.sqrt(max(0.0, L ** 2 - h ** 2)))
    Fc = m * (omega ** 2) * r

    r_c = 0.025  # spindle collar radius (m)
    dr = max(0.0, r - r_c)
    dz_lower = float(np.sqrt(max(0.0, l ** 2 - min(dr ** 2, l ** 2 * 0.99))))
    sleeve_drop = h + dz_lower
    lift_from_rest = max(0.0, (L + l) - sleeve_drop)
    return {
        'N': N, 'omega': omega, 'h': h, 'r': r, 'Fc': Fc,
        'L': L, 'l': l, 'm': m, 'M': M, 'q': q,
        'r_c': r_c, 'dz_lower': dz_lower, 'sleeve_lift': lift_from_rest,
        'lifted': h < L - 1e-6
    }


def solve_proell_state(N, params):
    m = max(0.05, _safe_float(params, 'ball_mass', 2.0))
    M = max(0.0, _safe_float(params, 'sleeve_mass', 5.0))
    L = max(0.05, _safe_float(params, 'arm_length', 0.3))
    l = max(0.05, _safe_float(params, 'link_length', 0.3))
    e = max(0.0, _safe_float(params, 'extension', 0.05))
    q = max(0.05, _safe_float(params, 'q', 1.0))
    omega = 2.0 * np.pi * N / 60.0
    ext_factor = 1.0 + e / l
    factor = ((m + M * (1.0 + q)) / m) * ext_factor
    h = min(factor * G / (omega ** 2), L) if omega > 0 else L
    r = float(np.sqrt(max(0.0, L ** 2 - h ** 2)))
    Fc = m * (omega ** 2) * r

    r_c = 0.025
    dr = max(0.0, r - r_c)
    dz_lower = float(np.sqrt(max(0.0, l ** 2 - min(dr ** 2, l ** 2 * 0.99))))
    link_len_eff = float(np.hypot(dr, dz_lower)) or 1e-6
    ux = dr / link_len_eff
    uz = dz_lower / link_len_eff
    r_ball = r + e * ux
    z_ball_rel_pivot = -h + e * uz
    sleeve_drop = h + dz_lower
    lift_from_rest = max(0.0, (L + l) - sleeve_drop)
    return {
        'N': N, 'omega': omega, 'h': h, 'r': r, 'r_ball': r_ball,
        'z_ball_rel': z_ball_rel_pivot, 'Fc': Fc,
        'L': L, 'l': l, 'e': e, 'm': m, 'M': M, 'q': q,
        'r_c': r_c, 'dz_lower': dz_lower, 'sleeve_lift': lift_from_rest,
        'lifted': h < L - 1e-6
    }


def solve_hartnell_state(N, params):
    m = max(0.05, _safe_float(params, 'ball_mass', 0.45))
    m1 = max(0.0, _safe_float(params, 'sleeve_mass', 2.1))
    m2 = max(0.0, _safe_float(params, 'mass_added', 0.10))
    a = max(10.0, _safe_float(params, 'vertical_arm', 75.0)) / 1000.0
    b = max(10.0, _safe_float(params, 'horizontal_arm', 95.0)) / 1000.0
    R0 = max(10.0, _safe_float(params, 'initial_radius', 132.5)) / 1000.0
    L0 = max(10.0, _safe_float(params, 'free_length', 154.0)) / 1000.0
    L1 = max(5.0, _safe_float(params, 'compressed_length', 145.0)) / 1000.0
    Nmin = _safe_float(params, 'N_min', 150.0)
    Nmax = max(Nmin + 1.0, _safe_float(params, 'N_max', 350.0))

    omega = 2.0 * np.pi * N / 60.0
    frac = max(0.0, min(1.0, (N - Nmin) / (Nmax - Nmin)))
    X = (frac * 25.0) / 1000.0
    R = R0 + X * (a / b)
    Fc = m * (omega ** 2) * R
    F_spring = max(0.0, 2.0 * Fc * (a / b) - (m1 + m2) * G)
    bell_angle = float(np.arcsin(min(0.85, (R - R0) / max(a, 1e-4))))
    return {
        'N': N, 'omega': omega, 'R': R, 'R0': R0, 'X': X,
        'Fc': Fc, 'F_spring': F_spring, 'a': a, 'b': b,
        'L0': L0, 'L1': L1, 'm': m, 'm1': m1, 'm2': m2,
        'bell_angle': bell_angle, 'frac': frac,
        'Nmin': Nmin, 'Nmax': Nmax
    }


# ──────────────────────────────────────────────
#  3D Drawing Primitives (Z-up upright frame)
# ──────────────────────────────────────────────

def _circle_xy(r, z, n=72):
    t = np.linspace(0, 2 * np.pi, n)
    return r * np.cos(t), r * np.sin(t), np.full_like(t, z)


def _style_3d_axis(ax, lim_xy, z_min, z_max, title=""):
    ax.set_facecolor('#141416')
    ax.set_xlim(-lim_xy, lim_xy)
    ax.set_ylim(-lim_xy, lim_xy)
    ax.set_zlim(z_min, z_max)
    ax.set_xlabel('X (mm)', color='#8e8e93', fontsize=8, labelpad=4)
    ax.set_ylabel('Y (mm)', color='#8e8e93', fontsize=8, labelpad=4)
    ax.set_zlabel('Z Height (mm)', color='#a1a1a6', fontsize=8, labelpad=6)
    ax.tick_params(colors='#8e8e93', labelsize=7)
    for pane in (ax.xaxis.pane, ax.yaxis.pane, ax.zaxis.pane):
        pane.fill = True
        pane.set_facecolor((0.10, 0.10, 0.11, 0.86))
        pane.set_edgecolor('#2c2c2e')
    ax.grid(True, color='#2c2c2e', linestyle=':', linewidth=0.55)
    if title:
        ax.set_title(title, color='#f5f5f7', fontsize=10, fontweight='semibold', pad=10)


def _draw_governor_3d(ax, gov_type, params, N, rot_deg=25.0, show_labels=True):
    """Draw upright 3D geometry (Z is vertical axis, units in mm)."""
    rot = np.radians(rot_deg)

    if gov_type == 'watt':
        st = solve_watt_state(N, params)
        L_mm = st['L'] * 1000.0
        h_mm = st['h'] * 1000.0
        r_mm = st['r'] * 1000.0
        z_piv = L_mm * 1.15
        z_ball = z_piv - h_mm

        bx, by, bz = _circle_xy(L_mm * 0.28, 0.0)
        ax.plot(bx, by, bz, color='#3a3a3c', lw=2.2)
        ax.plot([0, 0], [0, 0], [0, z_piv * 1.12], color='#8e8e93', lw=3.8)
        ax.scatter([0], [0], [z_piv], color='#f5f5f7', s=85, edgecolors='#0a84ff', lw=1.2, zorder=6)

        for i in range(2):
            ang = rot + i * np.pi
            px = r_mm * np.cos(ang)
            py = r_mm * np.sin(ang)
            ax.plot([0, px], [0, py], [z_piv, z_ball], color='#0a84ff', lw=3.0)
            ax.scatter([px], [py], [z_ball], color='#ff453a', s=195,
                       edgecolors='#ff8a80', lw=1.0, zorder=8)
            if st['Fc'] > 0.1:
                vec_len = min(L_mm * 0.45, 25.0 + st['Fc'] * 0.4)
                ax.quiver(px, py, z_ball,
                          vec_len * np.cos(ang), vec_len * np.sin(ang), 0,
                          color='#30d158', lw=1.8, arrow_length_ratio=0.25)

        if r_mm > 2:
            tx, ty, tz = _circle_xy(r_mm, z_ball)
            ax.plot(tx, ty, tz, color='#64d2ff', lw=1.2, ls='--', alpha=0.65)

        if show_labels:
            ax.plot([r_mm, r_mm], [0, 0], [z_ball, z_piv], color='#ff9f0a', lw=1.0, ls=':')
            ax.text2D(0.03, 0.04, f'h = {h_mm:.1f} mm  |  r = {r_mm:.1f} mm',
                      transform=ax.transAxes, color='#ff9f0a', fontsize=8.5,
                      bbox=dict(boxstyle='round,pad=0.35', facecolor='#1c1c1e', edgecolor='#2c2c2e', alpha=0.92))

        lim = L_mm * 1.25
        _style_3d_axis(
            ax, lim, 0, z_piv * 1.2,
            f'Watt Governor · N = {N:.0f} rpm · Fc = {st["Fc"]:.1f} N'
        )
        return st

    elif gov_type in ('porter', 'proell'):
        st = solve_porter_state(N, params) if gov_type == 'porter' else solve_proell_state(N, params)
        L_mm = st['L'] * 1000.0
        l_mm = st['l'] * 1000.0
        h_mm = st['h'] * 1000.0
        r_mm = st['r'] * 1000.0
        rc_mm = st['r_c'] * 1000.0
        dz_low = st['dz_lower'] * 1000.0

        z_piv = (L_mm + l_mm) * 1.08
        z_joint = z_piv - h_mm
        z_sleeve = z_joint - dz_low

        bx, by, bz = _circle_xy(L_mm * 0.3, 0.0)
        ax.plot(bx, by, bz, color='#3a3a3c', lw=2.2)
        ax.plot([0, 0], [0, 0], [0, z_piv * 1.08], color='#8e8e93', lw=4.2)
        ax.scatter([0], [0], [z_piv], color='#f5f5f7', s=80, edgecolors='#0a84ff', lw=1.2, zorder=6)

        sl_h = L_mm * 0.14
        sx, sy, sz_top = _circle_xy(rc_mm * 1.6, z_sleeve + sl_h * 0.35)
        _, _, sz_bot = _circle_xy(rc_mm * 1.6, z_sleeve - sl_h * 0.65)
        ax.plot(sx, sy, sz_top, color='#ff9f0a', lw=2.6)
        ax.plot(sx, sy, sz_bot, color='#cc7a00', lw=2.6)
        for k in range(0, len(sx), 12):
            ax.plot([sx[k], sx[k]], [sy[k], sy[k]], [sz_bot[k], sz_top[k]], color='#ff9f0a', lw=1.6)

        ball_r_ring = st['r_ball'] * 1000.0 if gov_type == 'proell' else r_mm
        ball_z = (z_piv + st['z_ball_rel'] * 1000.0) if gov_type == 'proell' else z_joint

        for i in range(2):
            ang = rot + i * np.pi
            ca, sa = np.cos(ang), np.sin(ang)
            jx, jy = r_mm * ca, r_mm * sa
            cx_sl, cy_sl = rc_mm * ca, rc_mm * sa

            ax.plot([0, jx], [0, jy], [z_piv, z_joint], color='#0a84ff', lw=2.8)
            ax.plot([cx_sl, jx], [cy_sl, jy], [z_sleeve, z_joint], color='#5e5ce6', lw=2.4)

            if gov_type == 'proell':
                ex = ball_r_ring * ca
                ey = ball_r_ring * sa
                ax.plot([jx, ex], [jy, ey], [z_joint, ball_z], color='#64d2ff', lw=3.0)
                ax.scatter([jx], [jy], [z_joint], color='#f5f5f7', s=42, zorder=7)
                ax.scatter([ex], [ey], [ball_z], color='#ff453a', s=195,
                           edgecolors='#ff8a80', lw=1.0, zorder=8)
                b_pos = (ex, ey, ball_z)
            else:
                ax.scatter([jx], [jy], [z_joint], color='#ff453a', s=195,
                           edgecolors='#ff8a80', lw=1.0, zorder=8)
                b_pos = (jx, jy, z_joint)

            if st['Fc'] > 0.1:
                vec_len = min(L_mm * 0.4, 25.0 + st['Fc'] * 0.25)
                ax.quiver(b_pos[0], b_pos[1], b_pos[2],
                          vec_len * ca, vec_len * sa, 0,
                          color='#30d158', lw=1.8, arrow_length_ratio=0.25)

        if ball_r_ring > 3:
            tx, ty, tz = _circle_xy(ball_r_ring, ball_z)
            ax.plot(tx, ty, tz, color='#64d2ff', lw=1.1, ls='--', alpha=0.65)

        if show_labels:
            ax.text2D(0.03, 0.04,
                      f'h = {h_mm:.1f} mm  |  r = {r_mm:.1f} mm  |  Lift = {st["sleeve_lift"]*1000:.1f} mm',
                      transform=ax.transAxes, color='#ff9f0a', fontsize=8.5,
                      bbox=dict(boxstyle='round,pad=0.35', facecolor='#1c1c1e', edgecolor='#2c2c2e', alpha=0.92))

        lim = (L_mm + (st.get('e', 0) * 1000.0)) * 1.25
        name = 'Porter' if gov_type == 'porter' else 'Proell'
        _style_3d_axis(
            ax, lim, 0, z_piv * 1.15,
            f'{name} Governor · N = {N:.0f} rpm · Fc = {st["Fc"]:.1f} N'
        )
        return st

    else:  # hartnell
        st = solve_hartnell_state(N, params)
        a_mm = st['a'] * 1000.0
        b_mm = st['b'] * 1000.0
        R_mm = st['R'] * 1000.0
        R0_mm = st['R0'] * 1000.0
        X_mm = st['X'] * 1000.0

        z_base = 0.0
        z_frame_top = 240.0
        z_sleeve_rest = 85.0
        z_sleeve = z_sleeve_rest + X_mm * 1.8
        z_spring_top = 225.0

        bx, by, bz = _circle_xy(75.0, z_base)
        ax.plot(bx, by, bz, color='#3a3a3c', lw=2.6)
        ax.plot([0, 0], [0, 0], [z_base, z_frame_top], color='#8e8e93', lw=4.5)

        cx_cap, cy_cap, cz_cap = _circle_xy(32.0, z_spring_top)
        ax.plot(cx_cap, cy_cap, cz_cap, color='#636366', lw=2.6)

        t_sp = np.linspace(0, 7 * 2 * np.pi, 260)
        sp_r = 22.0
        sp_x = sp_r * np.cos(t_sp)
        sp_y = sp_r * np.sin(t_sp)
        sp_z = np.linspace(z_sleeve + 14.0, z_spring_top, len(t_sp))
        ax.plot(sp_x, sp_y, sp_z, color='#30d158', lw=2.1)

        sx, sy, sz_t = _circle_xy(36.0, z_sleeve + 14.0)
        _, _, sz_b = _circle_xy(36.0, z_sleeve - 10.0)
        ax.plot(sx, sy, sz_t, color='#ff9f0a', lw=2.6)
        ax.plot(sx, sy, sz_b, color='#cc7a00', lw=2.6)
        for k in range(0, len(sx), 12):
            ax.plot([sx[k], sx[k]], [sy[k], sy[k]], [sz_b[k], sz_t[k]], color='#ff9f0a', lw=1.6)

        fulcrum_r = b_mm + 20.0
        for i in range(2):
            ang = rot + i * np.pi
            ca, sa = np.cos(ang), np.sin(ang)
            fx, fy, fz = fulcrum_r * ca, fulcrum_r * sa, z_sleeve_rest
            ax.plot([0, fx], [0, fy], [z_base + 25.0, fz], color='#3a3a3c', lw=1.8)
            ax.scatter([fx], [fy], [fz], color='#f5f5f7', s=55, edgecolors='#0a84ff', lw=1.0, zorder=7)

            sl_x, sl_y, sl_z = 36.0 * ca, 36.0 * sa, z_sleeve
            ax.plot([fx, sl_x], [fy, sl_y], [fz, sl_z], color='#5e5ce6', lw=2.6)

            bx_ball, by_ball = R_mm * ca, R_mm * sa
            bz_ball = fz + a_mm * np.cos(st['bell_angle'])
            ax.plot([fx, bx_ball], [fy, by_ball], [fz, bz_ball], color='#0a84ff', lw=3.0)
            ax.scatter([bx_ball], [by_ball], [bz_ball], color='#ff453a', s=200,
                       edgecolors='#ff8a80', lw=1.0, zorder=8)

            if st['Fc'] > 0.1:
                vec_len = min(70.0, 20.0 + st['Fc'] * 0.7)
                ax.quiver(bx_ball, by_ball, bz_ball,
                          vec_len * ca, vec_len * sa, 0,
                          color='#30d158', lw=1.8, arrow_length_ratio=0.25)

        tx, ty, tz = _circle_xy(R_mm, z_sleeve_rest + a_mm * np.cos(st['bell_angle']))
        ax.plot(tx, ty, tz, color='#64d2ff', lw=1.2, ls='--', alpha=0.65)

        if show_labels:
            ax.text2D(0.03, 0.04,
                      f'R = {R_mm:.1f} mm  |  X = {X_mm:.1f} mm  |  Spring S = {st["F_spring"]:.1f} N',
                      transform=ax.transAxes, color='#30d158', fontsize=8.5,
                      bbox=dict(boxstyle='round,pad=0.35', facecolor='#1c1c1e', edgecolor='#2c2c2e', alpha=0.92))

        lim = max(R0_mm + 90.0, 210.0)
        _style_3d_axis(
            ax, lim, 0, z_frame_top + 20,
            f'Hartnell Governor · N = {N:.0f} rpm · R = {R_mm:.1f} mm · S = {st["F_spring"]:.1f} N'
        )
        return st


# ──────────────────────────────────────────────
#  Matplotlib Figure Generators (Thread-Safe)
# ──────────────────────────────────────────────

def _fig_to_base64(fig, dpi=130):
    buf = io.BytesIO()
    FigureCanvasAgg(fig)
    fig.savefig(buf, format='png', dpi=dpi, facecolor=fig.get_facecolor())
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('ascii')


def _compute_curve_series(gov_type, params):
    Nmin = _safe_float(params, 'N_min', 150.0 if gov_type == 'hartnell' else 100.0)
    Nmax = _safe_float(params, 'N_max', 350.0 if gov_type == 'hartnell' else 300.0)
    if Nmax <= Nmin:
        Nmax = Nmin + 100.0
    Ns = np.linspace(Nmin, Nmax, 60)

    if gov_type == 'watt':
        states = [solve_watt_state(n, params) for n in Ns]
        y1 = [s['h'] * 1000.0 for s in states]
        y2 = [s['r'] * 1000.0 for s in states]
        y3 = [s['Fc'] for s in states]
        return Ns, y1, y2, y3, ('Height h (mm)', 'Radius r (mm)', 'Centrifugal Force Fc (N)')
    elif gov_type == 'porter':
        states = [solve_porter_state(n, params) for n in Ns]
        y1 = [s['h'] * 1000.0 for s in states]
        y2 = [s['sleeve_lift'] * 1000.0 for s in states]
        y3 = [s['Fc'] for s in states]
        return Ns, y1, y2, y3, ('Height h (mm)', 'Sleeve Lift (mm)', 'Centrifugal Force Fc (N)')
    elif gov_type == 'proell':
        states = [solve_proell_state(n, params) for n in Ns]
        y1 = [s['h'] * 1000.0 for s in states]
        y2 = [s['sleeve_lift'] * 1000.0 for s in states]
        y3 = [s['Fc'] for s in states]
        return Ns, y1, y2, y3, ('Height h (mm)', 'Sleeve Lift (mm)', 'Centrifugal Force Fc (N)')
    else:
        states = [solve_hartnell_state(n, params) for n in Ns]
        y1 = [s['R'] * 1000.0 for s in states]
        y2 = [s['X'] * 1000.0 for s in states]
        y3 = [s['F_spring'] for s in states]
        return Ns, y1, y2, y3, ('Radius R (mm)', 'Sleeve Lift X (mm)', 'Spring Force S (N)')


def render_operating_snapshot_b64(gov_type, params, speed=None):
    """Render side-by-side Python Matplotlib 3D Governor + Operating Curve Snapshot."""
    with _MATPLOTLIB_LOCK:
        Nmin = _safe_float(params, 'N_min', 150.0 if gov_type == 'hartnell' else 100.0)
        Nmax = _safe_float(params, 'N_max', 350.0 if gov_type == 'hartnell' else 300.0)
        N = float(speed) if speed is not None else 0.5 * (Nmin + Nmax)

        fig = Figure(figsize=(12, 5.4), facecolor='#141416')
        ax3d = fig.add_subplot(1, 2, 1, projection='3d')
        _draw_governor_3d(ax3d, gov_type, params, N, rot_deg=-45.0, show_labels=True)
        ax3d.view_init(elev=22, azim=38)

        ax2d = fig.add_subplot(1, 2, 2, facecolor='#18181b')
        Ns, y1, y2, y3, labels = _compute_curve_series(gov_type, params)

        ax2d.plot(Ns, y1, color='#0a84ff', lw=2.3, label=labels[0])
        ax2d.fill_between(Ns, y1, color='#0a84ff', alpha=0.08)
        ax2d.plot(Ns, y2, color='#64d2ff', lw=2.0, ls='--', label=labels[1])
        ax2d.axvline(N, color='#ff9f0a', lw=1.25, ls=':', alpha=0.9, label=f'Current N = {N:.0f} rpm')

        curr_y1 = float(np.interp(N, Ns, y1))
        curr_y2 = float(np.interp(N, Ns, y2))
        ax2d.scatter([N], [curr_y1], color='#ff453a', edgecolors='#18181b', lw=1.2, s=70, zorder=6)
        ax2d.scatter([N], [curr_y2], color='#ff9f0a', edgecolors='#18181b', lw=1.2, s=65, zorder=6)

        ax2d_r = ax2d.twinx()
        ax2d_r.plot(Ns, y3, color='#5e5ce6', lw=2.1, label=labels[2])
        curr_y3 = float(np.interp(N, Ns, y3))
        ax2d_r.scatter([N], [curr_y3], color='#30d158', edgecolors='#18181b', lw=1.2, s=70, zorder=6)
        ax2d_r.set_ylabel(labels[2], color='#9e9cf5', fontsize=9)
        ax2d_r.tick_params(axis='y', colors='#9e9cf5', labelsize=8)
        ax2d_r.spines['top'].set_visible(False)
        ax2d_r.spines['right'].set_color('#3a3a50')

        ax2d.set_xlabel('Spindle Speed N (rpm)', color='#a1a1a6', fontsize=9)
        ax2d.set_ylabel('Displacement / Geometry (mm)', color='#64d2ff', fontsize=9)
        ax2d.set_title('Live Characteristic Curves & Operating Point', color='#f5f5f7', fontsize=10, fontweight='semibold', pad=10)
        ax2d.tick_params(colors='#8e8e93', labelsize=8)
        ax2d.grid(True, color='#2c2c2e', linestyle=':', linewidth=0.7)
        for spine in ('left', 'bottom'):
            ax2d.spines[spine].set_color('#2c2c2e')
        ax2d.spines['top'].set_visible(False)

        lines1, lbls1 = ax2d.get_legend_handles_labels()
        lines2, lbls2 = ax2d_r.get_legend_handles_labels()
        ax2d.legend(lines1 + lines2, lbls1 + lbls2, loc='upper center',
                    bbox_to_anchor=(0.5, -0.14), ncol=2,
                    facecolor='#1c1c1e', edgecolor='#2c2c2e', labelcolor='#f5f5f7', fontsize=7.5)

        fig.suptitle(f'Python Matplotlib 3D Simulation — {gov_type.capitalize()} Governor',
                     color='#f5f5f7', fontsize=12.5, fontweight='semibold', y=0.98)
        fig.tight_layout(rect=[0, 0.04, 1, 0.94])
        return _fig_to_base64(fig)


def render_multispeed_b64(gov_type, params):
    """Generate 4-panel Matplotlib 3D comparison from N_min to N_max."""
    with _MATPLOTLIB_LOCK:
        Nmin = _safe_float(params, 'N_min', 150.0 if gov_type == 'hartnell' else 100.0)
        Nmax = _safe_float(params, 'N_max', 350.0 if gov_type == 'hartnell' else 300.0)
        if Nmax <= Nmin:
            Nmax = Nmin + 100.0
        speeds = np.linspace(Nmin, Nmax, 4)

        fig = Figure(figsize=(14, 4.2), facecolor='#141416')
        for idx, N in enumerate(speeds):
            ax = fig.add_subplot(1, 4, idx + 1, projection='3d')
            _draw_governor_3d(ax, gov_type, params, float(N), rot_deg=-45.0, show_labels=False)
            ax.view_init(elev=20, azim=38)
            ax.set_title(f'N = {N:.0f} rpm', color='#f5f5f7', fontsize=9.5, fontweight='semibold')

        fig.suptitle(f'{gov_type.capitalize()} Governor — Multi-Speed 3D Progression (Matplotlib)',
                     color='#f5f5f7', fontsize=12, fontweight='semibold', y=0.99)
        fig.tight_layout(rect=[0, 0, 1, 0.92])
        return _fig_to_base64(fig)


def render_animation_b64(gov_type, params, frames=36):
    """Generate an animated Matplotlib 3D + Characteristic Curve GIF and return base64."""
    with _MATPLOTLIB_LOCK:
        Nmin = _safe_float(params, 'N_min', 150.0 if gov_type == 'hartnell' else 100.0)
        Nmax = _safe_float(params, 'N_max', 350.0 if gov_type == 'hartnell' else 300.0)
        if Nmax <= Nmin:
            Nmax = Nmin + 100.0

        fig = Figure(figsize=(10.5, 4.8), facecolor='#141416')
        FigureCanvasAgg(fig)
        ax3d = fig.add_subplot(1, 2, 1, projection='3d')
        ax2d = fig.add_subplot(1, 2, 2, facecolor='#18181b')

        Ns, y1, y2, y3, labels = _compute_curve_series(gov_type, params)

        def update(frame):
            ax3d.cla()
            ax2d.cla()
            ax2d.set_facecolor('#18181b')

            t = frame / max(1, frames - 1)
            ramp = 2.0 * t if t <= 0.5 else 2.0 * (1.0 - t)
            N = Nmin + (Nmax - Nmin) * ramp
            rot_deg = frame * (360.0 / frames) * 2.0

            _draw_governor_3d(ax3d, gov_type, params, float(N), rot_deg=rot_deg, show_labels=True)
            ax3d.view_init(elev=22, azim=30 + frame * 1.5)

            ax2d.plot(Ns, y1, color='#0a84ff', lw=2.2, label=labels[0])
            ax2d.plot(Ns, y2, color='#64d2ff', lw=1.9, ls='--', label=labels[1])
            ax2d.plot(Ns, y3, color='#5e5ce6', lw=2.0, label=labels[2])
            ax2d.axvline(N, color='#ff9f0a', lw=1.25, ls=':')

            cy1 = float(np.interp(N, Ns, y1))
            cy2 = float(np.interp(N, Ns, y2))
            cy3 = float(np.interp(N, Ns, y3))
            ax2d.scatter([N, N, N], [cy1, cy2, cy3], color=['#ff453a', '#ff9f0a', '#30d158'],
                         edgecolors='#18181b', lw=1.0, s=60, zorder=6)

            ax2d.set_xlabel('Speed N (rpm)', color='#a1a1a6', fontsize=8.5)
            ax2d.set_ylabel('Magnitude (mm / N)', color='#a1a1a6', fontsize=8.5)
            ax2d.set_title(f'Operating Trajectory · N = {N:.0f} rpm', color='#f5f5f7', fontsize=9.5, fontweight='semibold')
            ax2d.tick_params(colors='#8e8e93', labelsize=7.5)
            ax2d.grid(True, color='#2c2c2e', linestyle=':', linewidth=0.65)
            for spine in ('left', 'bottom'):
                ax2d.spines[spine].set_color('#2c2c2e')
            ax2d.spines['top'].set_visible(False)
            ax2d.spines['right'].set_visible(False)
            ax2d.legend(loc='upper right', facecolor='#1c1c1e', edgecolor='#2c2c2e',
                        labelcolor='#f5f5f7', fontsize=7)

        fig.suptitle(f'Python Matplotlib 3D Dynamic Simulation — {gov_type.capitalize()} Governor',
                     color='#f5f5f7', fontsize=12, fontweight='semibold', y=0.98)
        fig.tight_layout(rect=[0, 0, 1, 0.94])

        ani = animation.FuncAnimation(fig, update, frames=frames, interval=90)
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.gif', delete=False) as tf:
                tmp_path = tf.name
            ani.save(tmp_path, writer='pillow', fps=12, savefig_kwargs={'facecolor': '#141416'})
            with open(tmp_path, 'rb') as f:
                return base64.b64encode(f.read()).decode('ascii')
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


# ──────────────────────────────────────────────
#  Standalone CLI Export Functions
# ──────────────────────────────────────────────

def plot_watt_3d(save=True):
    b64 = render_multispeed_b64('watt', {'ball_mass': 2.0, 'arm_length': 0.3, 'N_min': 100, 'N_max': 260})
    if save:
        path = os.path.join(OUTPUT_DIR, 'watt_3d.png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved: {path}')


def plot_porter_3d(save=True):
    b64 = render_multispeed_b64('porter', {'ball_mass': 2.0, 'sleeve_mass': 5.0, 'arm_length': 0.3, 'link_length': 0.3, 'N_min': 130, 'N_max': 300})
    if save:
        path = os.path.join(OUTPUT_DIR, 'porter_3d.png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved: {path}')


def plot_proell_3d(save=True):
    b64 = render_multispeed_b64('proell', {'ball_mass': 2.0, 'sleeve_mass': 5.0, 'arm_length': 0.3, 'link_length': 0.3, 'extension': 0.06, 'N_min': 140, 'N_max': 320})
    if save:
        path = os.path.join(OUTPUT_DIR, 'proell_3d.png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved: {path}')


def plot_hartnell_3d(save=True):
    b64 = render_multispeed_b64('hartnell', {'ball_mass': 0.45, 'sleeve_mass': 2.1, 'mass_added': 0.14, 'vertical_arm': 75, 'horizontal_arm': 95, 'initial_radius': 132.5, 'N_min': 150, 'N_max': 350})
    if save:
        path = os.path.join(OUTPUT_DIR, 'hartnell_3d.png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved: {path}')


def generate_animation(gov_type='watt', frames=36, save=True):
    defaults = {
        'watt': {'ball_mass': 2.0, 'arm_length': 0.3, 'N_min': 100, 'N_max': 260},
        'porter': {'ball_mass': 2.0, 'sleeve_mass': 5.0, 'arm_length': 0.3, 'link_length': 0.3, 'N_min': 130, 'N_max': 300},
        'proell': {'ball_mass': 2.0, 'sleeve_mass': 5.0, 'arm_length': 0.3, 'link_length': 0.3, 'extension': 0.06, 'N_min': 140, 'N_max': 320},
        'hartnell': {'ball_mass': 0.45, 'sleeve_mass': 2.1, 'mass_added': 0.14, 'vertical_arm': 75, 'horizontal_arm': 95, 'initial_radius': 132.5, 'N_min': 150, 'N_max': 350},
    }
    b64 = render_animation_b64(gov_type, defaults.get(gov_type, {}), frames=frames)
    if save:
        path = os.path.join(OUTPUT_DIR, f'{gov_type}_animation.gif')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'Saved animation: {path}')


if __name__ == '__main__':
    gov_type = sys.argv[1] if len(sys.argv) > 1 else 'all'
    print('=' * 52)
    print(' Governor 3D Simulation Generator (Matplotlib)')
    print('=' * 52)

    if gov_type in ('watt', 'all'):
        plot_watt_3d()
        generate_animation('watt', frames=30)
    if gov_type in ('porter', 'all'):
        plot_porter_3d()
        generate_animation('porter', frames=30)
    if gov_type in ('proell', 'all'):
        plot_proell_3d()
        generate_animation('proell', frames=30)
    if gov_type in ('hartnell', 'all'):
        plot_hartnell_3d()
        generate_animation('hartnell', frames=30)

    print('All Matplotlib 3D simulations generated in:', OUTPUT_DIR)
