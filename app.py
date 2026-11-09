"""
Governor Characteristics Dashboard - Backend Server
Dynamics of Machinery Lab Experiment
Covers: Watt, Porter, Proell, and Hartnell Governors
"""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import math
import os
import simulate_3d

class GovernorHandler(SimpleHTTPRequestHandler):
    """HTTP handler that serves static files and handles API requests."""

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        data = json.loads(post_data.decode('utf-8'))

        if self.path == '/api/calculate':
            governor_type = data.get('type', 'watt')
            params = data.get('params', {})

            try:
                if governor_type == 'watt':
                    result = calculate_watt(params)
                elif governor_type == 'porter':
                    result = calculate_porter(params)
                elif governor_type == 'proell':
                    result = calculate_proell(params)
                elif governor_type == 'hartnell':
                    result = calculate_hartnell(params)
                else:
                    result = {'error': 'Unknown governor type'}

                self._send_json(200, result)
            except Exception as e:
                self._send_json(500, {'error': str(e)})

        elif self.path == '/api/matplotlib_sim':
            governor_type = data.get('type', 'watt')
            params = data.get('params', {})
            mode = data.get('mode', 'snapshot')
            speed = data.get('speed', None)

            if governor_type not in ('watt', 'porter', 'proell', 'hartnell'):
                self._send_json(400, {'error': 'Unknown governor type'})
                return

            try:
                if mode == 'animation':
                    frames = int(data.get('frames', 30))
                    b64 = simulate_3d.render_animation_b64(governor_type, params, frames=frames)
                    self._send_json(200, {'mime': 'image/gif', 'image': b64, 'mode': mode})
                elif mode == 'multispeed':
                    b64 = simulate_3d.render_multispeed_b64(governor_type, params)
                    self._send_json(200, {'mime': 'image/png', 'image': b64, 'mode': mode})
                else:
                    b64 = simulate_3d.render_operating_snapshot_b64(governor_type, params, speed=speed)
                    self._send_json(200, {'mime': 'image/png', 'image': b64, 'mode': 'snapshot'})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?')[0]
        if clean_path == '/':
            self.path = '/index.html'
        elif any(part.startswith('.') for part in clean_path.split('/') if part):
            self.send_response(404)
            self.end_headers()
            return
        return SimpleHTTPRequestHandler.do_GET(self)


def calculate_watt(params):
    """
    Watt Governor Calculations
    h = g / omega^2 = 895 / N^2  (in metres)
    Fc = m * omega^2 * r
    """
    m = float(params.get('ball_mass', 2.0))           # kg
    arm_length = float(params.get('arm_length', 0.3))  # m
    N_min = float(params.get('N_min', 100))            # rpm
    N_max = float(params.get('N_max', 300))            # rpm
    N_steps = int(params.get('N_steps', 20))
    g = 9.81

    speeds = []
    heights = []
    radii = []
    centrifugal_forces = []
    sleeve_positions = []
    omega_list = []

    N_range = [N_min + i * (N_max - N_min) / N_steps for i in range(N_steps + 1)]

    for N in N_range:
        omega = 2 * math.pi * N / 60
        h = g / (omega ** 2)  # height in metres

        # Limit height by arm length
        if h > arm_length:
            h = arm_length

        # r = sqrt(L^2 - h^2) where L is arm length
        if arm_length ** 2 - h ** 2 > 0:
            r = math.sqrt(arm_length ** 2 - h ** 2)
        else:
            r = 0

        Fc = m * omega ** 2 * r

        speeds.append(round(N, 2))
        omega_list.append(round(omega, 4))
        heights.append(round(h * 1000, 4))       # convert to mm
        radii.append(round(r * 1000, 4))          # convert to mm
        centrifugal_forces.append(round(Fc, 4))
        sleeve_positions.append(round(h * 1000, 4))

    # Sensitivity calculation
    h_min = g / ((2 * math.pi * N_min / 60) ** 2)
    h_max_val = g / ((2 * math.pi * N_max / 60) ** 2)
    sensitivity = 2 * (N_max - N_min) / (N_max + N_min)

    # Range of speed
    speed_range = N_max - N_min
    mean_speed = (N_max + N_min) / 2
    coefficient_of_insensitiveness = speed_range / mean_speed

    return {
        'speeds': speeds,
        'omega': omega_list,
        'heights': heights,
        'radii': radii,
        'centrifugal_forces': centrifugal_forces,
        'sleeve_positions': sleeve_positions,
        'sensitivity': round(sensitivity, 6),
        'speed_range': round(speed_range, 2),
        'mean_speed': round(mean_speed, 2),
        'coeff_insensitiveness': round(coefficient_of_insensitiveness, 6),
        'governor_type': 'Watt Governor',
        'formulas': {
            'height': 'h = g / ω² = 895 / N² (metres)',
            'centrifugal_force': 'Fc = m·ω²·r',
            'radius': 'r = √(L² - h²)',
            'sensitivity': 'Sensitivity = 2(N₂ - N₁) / (N₂ + N₁)'
        }
    }


def calculate_porter(params):
    """
    Porter Governor Calculations
    h = [(m + M(1+q)) / m] * (g / omega^2)
    """
    m = float(params.get('ball_mass', 2.0))
    M = float(params.get('sleeve_mass', 5.0))
    arm_length = float(params.get('arm_length', 0.3))
    link_length = float(params.get('link_length', 0.3))
    N_min = float(params.get('N_min', 100))
    N_max = float(params.get('N_max', 300))
    N_steps = int(params.get('N_steps', 20))
    g = 9.81

    # q = tan(beta)/tan(alpha), for equal arms q = 1
    q = float(params.get('q', 1.0))

    speeds = []
    heights = []
    radii = []
    centrifugal_forces = []
    sleeve_lifts = []
    omega_list = []

    N_range = [N_min + i * (N_max - N_min) / N_steps for i in range(N_steps + 1)]

    h_initial = None

    for N in N_range:
        omega = 2 * math.pi * N / 60
        h = ((m + M * (1 + q)) / m) * (g / (omega ** 2))

        if h > arm_length:
            h = arm_length

        if arm_length ** 2 - h ** 2 > 0:
            r = math.sqrt(arm_length ** 2 - h ** 2)
        else:
            r = 0

        Fc = m * omega ** 2 * r

        if h_initial is None:
            h_initial = h
        sleeve_lift = 2 * (h_initial - h) * 1000  # mm (for equal arms)

        speeds.append(round(N, 2))
        omega_list.append(round(omega, 4))
        heights.append(round(h * 1000, 4))
        radii.append(round(r * 1000, 4))
        centrifugal_forces.append(round(Fc, 4))
        sleeve_lifts.append(round(max(0, sleeve_lift), 4))

    sensitivity = 2 * (N_max - N_min) / (N_max + N_min)
    speed_range = N_max - N_min
    mean_speed = (N_max + N_min) / 2

    return {
        'speeds': speeds,
        'omega': omega_list,
        'heights': heights,
        'radii': radii,
        'centrifugal_forces': centrifugal_forces,
        'sleeve_lifts': sleeve_lifts,
        'sensitivity': round(sensitivity, 6),
        'speed_range': round(speed_range, 2),
        'mean_speed': round(mean_speed, 2),
        'coeff_insensitiveness': round(speed_range / mean_speed, 6),
        'governor_type': 'Porter Governor',
        'formulas': {
            'height': 'h = [(m + M(1+q)) / m] × (g / ω²)',
            'centrifugal_force': 'Fc = m·ω²·r',
            'sleeve_lift': 's = 2(h₁ - h₂)',
            'sensitivity': 'Sensitivity = 2(N₂ - N₁) / (N₂ + N₁)'
        }
    }


def calculate_proell(params):
    """
    Proell Governor Calculations
    Similar to Porter but with extended lower link
    The ball is on extension of lower link, giving greater sensitivity
    """
    m = float(params.get('ball_mass', 2.0))
    M = float(params.get('sleeve_mass', 5.0))
    arm_length = float(params.get('arm_length', 0.3))
    link_length = float(params.get('link_length', 0.3))
    extension = float(params.get('extension', 0.05))  # extension length e
    N_min = float(params.get('N_min', 100))
    N_max = float(params.get('N_max', 300))
    N_steps = int(params.get('N_steps', 20))
    g = 9.81
    q = float(params.get('q', 1.0))

    speeds = []
    heights = []
    radii = []
    centrifugal_forces = []
    sleeve_lifts = []
    omega_list = []

    N_range = [N_min + i * (N_max - N_min) / N_steps for i in range(N_steps + 1)]

    h_initial = None
    # Proell: effective factor due to extension
    # The extension of the lower link increases the effective moment arm
    ext_factor = 1 + extension / link_length

    for N in N_range:
        omega = 2 * math.pi * N / 60
        # Proell height with extension factor
        h = ((m + M * (1 + q)) / m) * ext_factor * (g / (omega ** 2))

        if h > arm_length:
            h = arm_length

        if arm_length ** 2 - h ** 2 > 0:
            r = math.sqrt(arm_length ** 2 - h ** 2)
        else:
            r = 0

        Fc = m * omega ** 2 * r

        if h_initial is None:
            h_initial = h
        sleeve_lift = 2 * (h_initial - h) * 1000

        speeds.append(round(N, 2))
        omega_list.append(round(omega, 4))
        heights.append(round(h * 1000, 4))
        radii.append(round(r * 1000, 4))
        centrifugal_forces.append(round(Fc, 4))
        sleeve_lifts.append(round(max(0, sleeve_lift), 4))

    sensitivity = 2 * (N_max - N_min) / (N_max + N_min)
    speed_range = N_max - N_min
    mean_speed = (N_max + N_min) / 2

    return {
        'speeds': speeds,
        'omega': omega_list,
        'heights': heights,
        'radii': radii,
        'centrifugal_forces': centrifugal_forces,
        'sleeve_lifts': sleeve_lifts,
        'sensitivity': round(sensitivity, 6),
        'speed_range': round(speed_range, 2),
        'mean_speed': round(mean_speed, 2),
        'coeff_insensitiveness': round(speed_range / mean_speed, 6),
        'governor_type': 'Proell Governor',
        'formulas': {
            'height': 'h = [(m + M(1+q)) / m] × (1 + e/l) × (g / ω²)',
            'centrifugal_force': 'Fc = m·ω²·r',
            'sleeve_lift': 's = 2(h₁ - h₂)',
            'sensitivity': 'Sensitivity = 2(N₂ - N₁) / (N₂ + N₁)'
        }
    }


def calculate_hartnell(params):
    """
    Hartnell Governor Calculations (Spring-Controlled)
    Fc × a = (S + Mg/2) × b
    Stiffness s = (a/b)² × 2(Fc2 - Fc1) / (r2 - r1)
    """
    m = float(params.get('ball_mass', 0.45))          # kg
    M_sleeve = float(params.get('sleeve_mass', 2.1))   # kg
    M_added = float(params.get('mass_added', 0.10))     # kg (additional mass)
    a = float(params.get('vertical_arm', 75.0))
    b = float(params.get('horizontal_arm', 95.0))
    R0 = float(params.get('initial_radius', 132.5))
    L0 = float(params.get('free_length', 154.0))
    L1 = float(params.get('compressed_length', 145.0))
    if a > 1: a /= 1000.0
    if b > 1: b /= 1000.0
    if R0 > 1: R0 /= 1000.0
    if L0 > 1: L0 /= 1000.0
    if L1 > 1: L1 /= 1000.0
    X0 = float(params.get('initial_pointer', 0.0))      # mm (initial pointer reading)
    N_min = float(params.get('N_min', 150))             # rpm
    N_max = float(params.get('N_max', 350))             # rpm
    N_steps = int(params.get('N_steps', 20))
    g = 9.81

    speeds = []
    omega_list = []
    radii = []
    centrifugal_forces = []
    spring_forces = []
    spring_stiffnesses = []
    sleeve_displacements = []
    force_exerted_spring = []

    N_range = [N_min + i * (N_max - N_min) / N_steps for i in range(N_steps + 1)]

    # Initial spring compression
    delta_initial = L0 - L1  # initial compression in m

    prev_Fc = None
    prev_r = None

    results_table = []

    for i, N in enumerate(N_range):
        omega = 2 * math.pi * N / 60

        # Sleeve displacement X (from pointer reading)
        # Simulate: as speed increases, sleeve rises
        # X = X0 + some displacement proportional to speed increase
        # Using the observation table pattern from the lab
        X = X0 + (N - N_min) / (N_max - N_min) * 25  # mm range approx

        # Radius of rotation R = R0 + X * (a/b)
        R = R0 + (X / 1000) * (a / b)  # convert X from mm to m

        # Centrifugal force
        Fc = m * omega ** 2 * R

        # Force exerted by spring: 2*Fc*(a/b) - (m1+m2)*g
        total_mass = M_sleeve + M_added
        F_spring = 2 * Fc * (a / b) - total_mass * g

        # Compression of spring delta = L1 - L0 + something
        # delta = initial_compression + sleeve_disp * factor
        delta = delta_initial + (X / 1000)

        # Spring stiffness
        if delta > 0:
            s = F_spring / (delta * 1000)  # N/mm
        else:
            s = 0

        speeds.append(round(N, 2))
        omega_list.append(round(omega, 4))
        radii.append(round(R * 1000, 4))  # mm
        centrifugal_forces.append(round(Fc, 4))
        spring_forces.append(round(max(0, F_spring), 4))
        sleeve_displacements.append(round(X, 4))

        if F_spring > 0 and delta > 0:
            spring_stiffnesses.append(round(s, 4))
        else:
            spring_stiffnesses.append(0)

        results_table.append({
            'N': round(N, 2),
            'omega': round(omega, 4),
            'X': round(X, 4),
            'R': round(R * 1000, 4),
            'Fc': round(Fc, 4),
            'F_spring': round(max(0, F_spring), 4),
            's': round(s, 4) if s > 0 else 0
        })

    # Overall stiffness between min and max
    Fc_min = m * (2 * math.pi * N_min / 60) ** 2 * R0
    R_max = R0 + 25 / 1000 * (a / b)
    Fc_max = m * (2 * math.pi * N_max / 60) ** 2 * R_max
    overall_stiffness = (a / b) ** 2 * 2 * (Fc_max - Fc_min) / (R_max - R0) if R_max != R0 else 0

    sensitivity = 2 * (N_max - N_min) / (N_max + N_min)

    return {
        'speeds': speeds,
        'omega': omega_list,
        'radii': radii,
        'centrifugal_forces': centrifugal_forces,
        'spring_forces': spring_forces,
        'spring_stiffnesses': spring_stiffnesses,
        'sleeve_displacements': sleeve_displacements,
        'overall_stiffness': round(overall_stiffness, 4),
        'sensitivity': round(sensitivity, 6),
        'speed_range': round(N_max - N_min, 2),
        'mean_speed': round((N_max + N_min) / 2, 2),
        'results_table': results_table,
        'governor_type': 'Hartnell Governor',
        'formulas': {
            'centrifugal_force': 'Fc = m·ω²·R',
            'radius': 'R = R₀ + X·(a/b)',
            'spring_force': 'F_spring = 2·Fc·(a/b) - (m₁+m₂)·g',
            'stiffness': 's = (a/b)² × 2(Fc₂ - Fc₁) / (r₂ - r₁)',
            'sensitivity': 'Sensitivity = 2(N₂ - N₁) / (N₂ + N₁)'
        }
    }


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    host = os.environ.get('HOST', '0.0.0.0')
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer((host, port), GovernorHandler)
    print("Governor Characteristics Dashboard")
    print(f"Server running at http://localhost:{port} (bound {host}:{port})")
    print("Press Ctrl+C to stop")
    server.serve_forever()
