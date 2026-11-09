/* =============================================
   Governor Virtual Twin - Three.js 3D Interactive Model
   Physically accurate, parameter-driven 3D Digital Twin
   ============================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const G = 9.81;

class GovernorVirtualTwin {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.governorType = null;
        this.params = {};
        this.speed = 150; // target rpm
        this.visualSpeed = 150; // spring-damped display rpm
        this._suppressHud = false;
        this.maxSpeed = 400;
        this.paused = false;
        this.parts = {};
        this.rotationAngle = 0;

        this.initScene();
        this.initLights();
        this.initControls();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => this.onResize()).observe(this.container);
        }
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111113);
        this.scene.fog = new THREE.FogExp2(0x111113, 0.014);

        const w = Math.max(this.container.clientWidth, 300);
        const h = Math.max(this.container.clientHeight, 380);

        this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
        this.camera.position.set(4.8, 3.6, 5.4);
        this.camera.lookAt(0, 1.9, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        const gridHelper = new THREE.GridHelper(12, 24, 0x2a2a2e, 0x1c1c1f);
        this.scene.add(gridHelper);

        const groundGeo = new THREE.PlaneGeometry(12, 12);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x111113, transparent: true, opacity: 0.72, roughness: 0.92
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    initLights() {
        const ambient = new THREE.AmbientLight(0xd1d1d6, 0.75);
        this.scene.add(ambient);

        const key = new THREE.DirectionalLight(0xffffff, 1.45);
        key.position.set(5, 8, 5);
        key.castShadow = true;
        key.shadow.mapSize.width = 1024;
        key.shadow.mapSize.height = 1024;
        this.scene.add(key);

        const fill = new THREE.DirectionalLight(0x98c8ff, 0.55);
        fill.position.set(-5, 3, -4);
        this.scene.add(fill);

        const rim = new THREE.PointLight(0xe5e5ea, 0.55, 22);
        rim.position.set(0, 6, -5);
        this.scene.add(rim);
    }

    initControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2.8;
        this.controls.maxDistance = 14;
        this.controls.target.set(0, 1.9, 0);
        this.controls.maxPolarAngle = Math.PI * 0.85;
    }

    onResize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w <= 0 || h <= 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    setCameraView(preset) {
        if (!this.controls) return;
        if (preset === 'front') {
            this.camera.position.set(0, 2.2, 6.8);
        } else if (preset === 'top') {
            this.camera.position.set(0.01, 7.6, 0.01);
        } else {
            this.camera.position.set(4.8, 3.6, 5.4);
        }
        this.controls.target.set(0, 1.9, 0);
        this.controls.update();
    }

    togglePause() {
        this.paused = !this.paused;
        return this.paused;
    }

    getMaterials() {
        return {
            spindle: new THREE.MeshStandardMaterial({
                color: 0x8e8e93, metalness: 0.85, roughness: 0.22
            }),
            frame: new THREE.MeshStandardMaterial({
                color: 0x3a3a3c, metalness: 0.78, roughness: 0.32
            }),
            arm: new THREE.MeshStandardMaterial({
                color: 0x0a84ff, metalness: 0.55, roughness: 0.28
            }),
            ball: new THREE.MeshStandardMaterial({
                color: 0xff453a, metalness: 0.45, roughness: 0.22
            }),
            sleeve: new THREE.MeshStandardMaterial({
                color: 0xff9f0a, metalness: 0.60, roughness: 0.26
            }),
            link: new THREE.MeshStandardMaterial({
                color: 0x5e5ce6, metalness: 0.55, roughness: 0.30
            }),
            spring: new THREE.MeshStandardMaterial({
                color: 0x30d158, metalness: 0.50, roughness: 0.28
            }),
            extension: new THREE.MeshStandardMaterial({
                color: 0x64d2ff, metalness: 0.55, roughness: 0.28
            }),
            pivot: new THREE.MeshStandardMaterial({
                color: 0xf5f5f7, metalness: 0.90, roughness: 0.14
            }),
            trail: new THREE.LineBasicMaterial({
                color: 0x64d2ff, transparent: true, opacity: 0.55
            })
        };
    }

    clearGovernor() {
        if (this.parts.group) {
            this.scene.remove(this.parts.group);
            this.parts.group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        this.parts = {};
    }

    // Helper: create a unit-Y cylinder rod that we can position & orient between two 3D points
    _createRod(radius, material) {
        const geo = new THREE.CylinderGeometry(radius, radius, 1.0, 12);
        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true;
        return mesh;
    }

    _placeRodBetween(rodMesh, p1, p2) {
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();
        if (len < 1e-5) {
            rodMesh.visible = false;
            return;
        }
        rodMesh.visible = true;
        rodMesh.position.copy(p1).addScaledVector(dir, 0.5);
        rodMesh.scale.set(1, len, 1);
        rodMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }

    _createTrajectoryRing(material) {
        const pts = [];
        const segs = 72;
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        return new THREE.Line(geo, material);
    }

    _createForceArrow() {
        return new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 0),
            0.5,
            0x30d158,
            0.14,
            0.09
        );
    }

    // ──── Build & Parameterize Governor Models ────

    setGovernor(type, params = {}) {
        this.governorType = type;
        this.params = { ...params };
        this.visualSpeed = this.speed;
        this.clearGovernor();

        const group = new THREE.Group();
        this.parts.group = group;
        const mat = this.getMaterials();

        switch (type) {
            case 'watt':     this.buildWatt(group, mat); break;
            case 'porter':   this.buildPorter(group, mat); break;
            case 'proell':   this.buildProell(group, mat); break;
            case 'hartnell': this.buildHartnell(group, mat); break;
        }

        this.scene.add(group);
        this.onResize();
        this.updateGovernor(this.speed);
    }

    updateParams(params = {}) {
        this.params = { ...params };
        if (this.governorType) {
            // Rebuild geometry if proportions changed cleanly
            this.setGovernor(this.governorType, this.params);
        }
    }

    _getBallScale() {
        const m = parseFloat(this.params.ball_mass ?? (this.governorType === 'hartnell' ? 0.45 : 2.0));
        if (this.governorType === 'hartnell') {
            return Math.max(0.12, Math.min(0.24, 0.14 + (m - 0.45) * 0.05));
        }
        return Math.max(0.13, Math.min(0.28, 0.14 + m * 0.02));
    }

    buildWatt(group, mat) {
        const L_real = parseFloat(this.params.arm_length || 0.3);
        const visScale = 2.2 / Math.max(0.15, Math.min(0.6, L_real)); // keeps model ~2.2 units arm
        this.parts.visScale = visScale;
        this.parts.pivotY = 3.8;

        // Base + Spindle
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.16, 28), mat.frame);
        base.position.y = 0.08;
        base.castShadow = true;
        group.add(base);

        const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.3, 18), mat.spindle);
        spindle.position.y = 2.15;
        spindle.castShadow = true;
        group.add(spindle);

        const rotGroup = new THREE.Group();
        group.add(rotGroup);
        this.parts.rotGroup = rotGroup;

        const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 18), mat.pivot);
        pivot.position.y = this.parts.pivotY;
        rotGroup.add(pivot);

        const ballR = this._getBallScale();
        this.parts.arms = [];
        this.parts.balls = [];
        this.parts.forceArrows = [];

        for (let i = 0; i < 2; i++) {
            const arm = this._createRod(0.032, mat.arm);
            rotGroup.add(arm);
            this.parts.arms.push(arm);

            const ball = new THREE.Mesh(new THREE.SphereGeometry(ballR, 24, 24), mat.ball);
            ball.castShadow = true;
            rotGroup.add(ball);
            this.parts.balls.push(ball);

            const arrow = this._createForceArrow();
            rotGroup.add(arrow);
            this.parts.forceArrows.push(arrow);
        }

        const ring = this._createTrajectoryRing(mat.trail);
        group.add(ring);
        this.parts.ring = ring;
    }

    buildPorter(group, mat) {
        this.buildWatt(group, mat);
        this.parts.pivotY = 4.0;
        // Adjust pivot sphere inside rotGroup
        this.parts.rotGroup.children[0].position.y = this.parts.pivotY;

        // Sleeve + Dead Weight
        const M = parseFloat(this.params.sleeve_mass || 5.0);
        const weightH = Math.max(0.18, Math.min(0.42, 0.16 + M * 0.025));

        const sleeveGroup = new THREE.Group();
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.24, 24), mat.sleeve);
        collar.castShadow = true;
        sleeveGroup.add(collar);

        const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, weightH, 24), mat.sleeve);
        weight.position.y = -(0.12 + weightH * 0.5);
        weight.castShadow = true;
        sleeveGroup.add(weight);

        this.parts.rotGroup.add(sleeveGroup);
        this.parts.sleeve = sleeveGroup;

        this.parts.links = [];
        for (let i = 0; i < 2; i++) {
            const link = this._createRod(0.026, mat.link);
            this.parts.rotGroup.add(link);
            this.parts.links.push(link);
        }
    }

    buildProell(group, mat) {
        this.buildPorter(group, mat);

        // Add junction pins & extension rods beyond the arm-link junction
        this.parts.joints = [];
        this.parts.extensions = [];
        for (let i = 0; i < 2; i++) {
            const pin = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 16), mat.pivot);
            this.parts.rotGroup.add(pin);
            this.parts.joints.push(pin);

            const ext = this._createRod(0.028, mat.extension);
            this.parts.rotGroup.add(ext);
            this.parts.extensions.push(ext);
        }
    }

    buildHartnell(group, mat) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.16, 28), mat.frame);
        base.position.y = 0.08;
        base.castShadow = true;
        group.add(base);

        const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 4.4, 18), mat.spindle);
        spindle.position.y = 2.2;
        spindle.castShadow = true;
        group.add(spindle);

        const rotGroup = new THREE.Group();
        group.add(rotGroup);
        this.parts.rotGroup = rotGroup;

        // Top fixed spring retainer cap (attached to rotating frame)
        const topCapY = 3.85;
        const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 24), mat.frame);
        topCap.position.y = topCapY;
        rotGroup.add(topCap);
        this.parts.topCapY = topCapY;

        // Helical spring anchored at topCapY extending downward by 1.0 unit initially (scaled dynamically)
        const springGroup = new THREE.Group();
        this.buildSpring(springGroup, mat.spring, 0.16, 1.0, 8);
        springGroup.position.y = topCapY - 0.05;
        rotGroup.add(springGroup);
        this.parts.springGroup = springGroup;

        // Sliding Sleeve (sits below spring)
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.24, 24), mat.sleeve);
        sleeve.castShadow = true;
        rotGroup.add(sleeve);
        this.parts.sleeve = sleeve;

        // Rotating frame crossbar holding bell-crank fulcrums
        const a_mm = parseFloat(this.params.vertical_arm || 75);
        const b_mm = parseFloat(this.params.horizontal_arm || 95);
        const R0_mm = parseFloat(this.params.initial_radius || 132.5);
        const scaleMM = 1.0 / 85.0; // ~85mm -> 1.0 scene unit
        this.parts.scaleMM = scaleMM;
        this.parts.fulcrumR = Math.max(0.65, R0_mm * scaleMM);
        this.parts.fulcrumY = 1.95;

        const crossBar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, this.parts.fulcrumR * 2, 12),
            mat.frame
        );
        crossBar.rotation.z = Math.PI / 2;
        crossBar.position.y = 1.45;
        rotGroup.add(crossBar);

        this.parts.bellArmsV = [];
        this.parts.bellArmsH = [];
        this.parts.balls = [];
        this.parts.forceArrows = [];

        const ballR = this._getBallScale();
        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? 1 : -1;
            const post = this._createRod(0.035, mat.frame);
            this._placeRodBetween(
                post,
                new THREE.Vector3(sign * this.parts.fulcrumR, 1.45, 0),
                new THREE.Vector3(sign * this.parts.fulcrumR, this.parts.fulcrumY, 0)
            );
            rotGroup.add(post);

            const fulcrum = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), mat.pivot);
            fulcrum.position.set(sign * this.parts.fulcrumR, this.parts.fulcrumY, 0);
            rotGroup.add(fulcrum);

            const armV = this._createRod(0.032, mat.arm);
            rotGroup.add(armV);
            this.parts.bellArmsV.push(armV);

            const armH = this._createRod(0.028, mat.link);
            rotGroup.add(armH);
            this.parts.bellArmsH.push(armH);

            const ball = new THREE.Mesh(new THREE.SphereGeometry(ballR, 24, 24), mat.ball);
            ball.castShadow = true;
            rotGroup.add(ball);
            this.parts.balls.push(ball);

            const arrow = this._createForceArrow();
            rotGroup.add(arrow);
            this.parts.forceArrows.push(arrow);
        }

        const ring = this._createTrajectoryRing(mat.trail);
        group.add(ring);
        this.parts.ring = ring;
    }

    buildSpring(group, material, radius, height, coils) {
        const points = [];
        const segments = coils * 28;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * coils * Math.PI * 2;
            points.push(new THREE.Vector3(
                radius * Math.cos(angle),
                -t * height,
                radius * Math.sin(angle)
            ));
        }
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.024, 8, false);
        const spring = new THREE.Mesh(tubeGeo, material);
        spring.castShadow = true;
        group.add(spring);
    }

    // ──── Kinematic State Updates ────

    setSpeed(rpm) {
        this.speed = Math.max(0, Math.min(this.maxSpeed, parseFloat(rpm) || 0));
        const prevVisual = this.visualSpeed;
        this._suppressHud = false;
        this.updateGovernor(this.speed);
        if (Math.abs(this.speed - prevVisual) > 0.5) {
            this._suppressHud = true;
            this.updateGovernor(prevVisual);
            this._suppressHud = false;
        }
    }

    updateGovernor(N) {
        if (!this.governorType) return;
        const omega = (2 * Math.PI * N) / 60;

        switch (this.governorType) {
            case 'watt':     this.updateWatt(N, omega); break;
            case 'porter':   this.updatePorter(N, omega); break;
            case 'proell':   this.updateProell(N, omega); break;
            case 'hartnell': this.updateHartnell(N, omega); break;
        }
    }

    updateWatt(N, omega) {
        const m = parseFloat(this.params.ball_mass || 2.0);
        const L = parseFloat(this.params.arm_length || 0.3);
        const h = omega > 0 ? Math.min(G / (omega * omega), L) : L;
        const r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;

        const s = this.parts.visScale || 7.0;
        const piv = new THREE.Vector3(0, this.parts.pivotY, 0);
        const rVis = r * s;
        const hVis = h * s;
        const yBall = this.parts.pivotY - hVis;

        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? 1 : -1;
            const pBall = new THREE.Vector3(sign * rVis, yBall, 0);
            this._placeRodBetween(this.parts.arms[i], piv, pBall);
            this.parts.balls[i].position.copy(pBall);

            const arrow = this.parts.forceArrows[i];
            if (Fc > 0.2) {
                arrow.visible = true;
                arrow.position.copy(pBall);
                arrow.setDirection(new THREE.Vector3(sign, 0, 0));
                arrow.setLength(Math.min(1.2, 0.25 + Fc * 0.012), 0.14, 0.08);
            } else {
                arrow.visible = false;
            }
        }

        if (this.parts.ring) {
            this.parts.ring.visible = rVis > 0.05;
            this.parts.ring.position.y = yBall;
            this.parts.ring.scale.set(rVis, 1, rVis);
        }

        const stateText = h >= L - 1e-4 ? 'At Rest (Low Speed)' : 'Active Equilibrium';
        this.updateInfoDisplay({
            N, omega, h: h * 1000, r: r * 1000, Fc, stateText
        });
    }

    updatePorter(N, omega) {
        const m = parseFloat(this.params.ball_mass || 2.0);
        const M = parseFloat(this.params.sleeve_mass || 5.0);
        const L = parseFloat(this.params.arm_length || 0.3);
        const l = parseFloat(this.params.link_length || 0.3);
        const q = parseFloat(this.params.q || 1.0);

        const factor = (m + M * (1 + q)) / m;
        const h = omega > 0 ? Math.min(factor * G / (omega * omega), L) : L;
        const r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;

        const rc = 0.025;
        const dr = Math.max(0, r - rc);
        const dzLower = Math.sqrt(Math.max(0, l * l - Math.min(dr * dr, l * l * 0.99)));
        const sleeveLift = Math.max(0, (L + l) - (h + dzLower));

        const s = this.parts.visScale || 6.5;
        const piv = new THREE.Vector3(0, this.parts.pivotY, 0);
        const yJoint = this.parts.pivotY - h * s;
        const ySleeve = yJoint - dzLower * s;
        const rcVis = 0.19;

        if (this.parts.sleeve) {
            this.parts.sleeve.position.y = ySleeve;
        }

        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? 1 : -1;
            const pJoint = new THREE.Vector3(sign * Math.max(rcVis, r * s), yJoint, 0);
            const pCollar = new THREE.Vector3(sign * rcVis, ySleeve, 0);

            this._placeRodBetween(this.parts.arms[i], piv, pJoint);
            this._placeRodBetween(this.parts.links[i], pCollar, pJoint);
            this.parts.balls[i].position.copy(pJoint);

            const arrow = this.parts.forceArrows[i];
            if (Fc > 0.2 && r > 0.01) {
                arrow.visible = true;
                arrow.position.copy(pJoint);
                arrow.setDirection(new THREE.Vector3(sign, 0, 0));
                arrow.setLength(Math.min(1.2, 0.25 + Fc * 0.008), 0.14, 0.08);
            } else {
                arrow.visible = false;
            }
        }

        if (this.parts.ring) {
            const rRing = Math.max(rcVis, r * s);
            this.parts.ring.visible = r > 0.01;
            this.parts.ring.position.y = yJoint;
            this.parts.ring.scale.set(rRing, 1, rRing);
        }

        const stateText = h >= L - 1e-4 ? 'Below Lift Speed (Sleeve Seated)' : 'Active Equilibrium (Lifted)';
        this.updateInfoDisplay({
            N, omega, h: h * 1000, r: r * 1000, Fc, lift: sleeveLift * 1000, stateText
        });
    }

    updateProell(N, omega) {
        const m = parseFloat(this.params.ball_mass || 2.0);
        const M = parseFloat(this.params.sleeve_mass || 5.0);
        const L = parseFloat(this.params.arm_length || 0.3);
        const l = parseFloat(this.params.link_length || 0.3);
        const e = parseFloat(this.params.extension || 0.05);
        const q = parseFloat(this.params.q || 1.0);

        const extFactor = 1 + e / l;
        const factor = ((m + M * (1 + q)) / m) * extFactor;
        const h = omega > 0 ? Math.min(factor * G / (omega * omega), L) : L;
        const r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;

        const rc = 0.025;
        const dr = Math.max(0, r - rc);
        const dzLower = Math.sqrt(Math.max(0, l * l - Math.min(dr * dr, l * l * 0.99)));
        const sleeveLift = Math.max(0, (L + l) - (h + dzLower));

        const s = this.parts.visScale || 6.5;
        const piv = new THREE.Vector3(0, this.parts.pivotY, 0);
        const yJoint = this.parts.pivotY - h * s;
        const ySleeve = yJoint - dzLower * s;
        const rcVis = 0.19;

        if (this.parts.sleeve) {
            this.parts.sleeve.position.y = ySleeve;
        }

        let ballY = yJoint;
        let ballR = r * s;

        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? 1 : -1;
            const pJoint = new THREE.Vector3(sign * Math.max(rcVis, r * s), yJoint, 0);
            const pCollar = new THREE.Vector3(sign * rcVis, ySleeve, 0);

            // Extension continues rigidly along the lower link direction past pJoint
            const linkDir = new THREE.Vector3().subVectors(pJoint, pCollar).normalize();
            const pBall = pJoint.clone().addScaledVector(linkDir, Math.max(0.25, e * s * 1.4));

            this._placeRodBetween(this.parts.arms[i], piv, pJoint);
            this._placeRodBetween(this.parts.links[i], pCollar, pJoint);
            this._placeRodBetween(this.parts.extensions[i], pJoint, pBall);
            this.parts.joints[i].position.copy(pJoint);
            this.parts.balls[i].position.copy(pBall);

            ballY = pBall.y;
            ballR = Math.abs(pBall.x);

            const arrow = this.parts.forceArrows[i];
            if (Fc > 0.2 && r > 0.01) {
                arrow.visible = true;
                arrow.position.copy(pBall);
                arrow.setDirection(new THREE.Vector3(sign, 0, 0));
                arrow.setLength(Math.min(1.2, 0.25 + Fc * 0.008), 0.14, 0.08);
            } else {
                arrow.visible = false;
            }
        }

        if (this.parts.ring) {
            this.parts.ring.visible = r > 0.01;
            this.parts.ring.position.y = ballY;
            this.parts.ring.scale.set(ballR, 1, ballR);
        }

        const stateText = h >= L - 1e-4 ? 'Below Lift Speed (Sleeve Seated)' : 'Extended-Link Equilibrium';
        this.updateInfoDisplay({
            N, omega, h: h * 1000, r: r * 1000, Fc, lift: sleeveLift * 1000, stateText
        });
    }

    updateHartnell(N, omega) {
        const m = parseFloat(this.params.ball_mass || 0.45);
        const m1 = parseFloat(this.params.sleeve_mass || 2.1);
        const m2 = parseFloat(this.params.mass_added || 0.10);
        const a_mm = parseFloat(this.params.vertical_arm || 75);
        const b_mm = parseFloat(this.params.horizontal_arm || 95);
        const R0_mm = parseFloat(this.params.initial_radius || 132.5);
        const Nmin = parseFloat(this.params.N_min || 150);
        const Nmax = Math.max(Nmin + 1, parseFloat(this.params.N_max || 350));

        const frac = Math.max(0, Math.min(1, (N - Nmin) / (Nmax - Nmin)));
        const X_mm = frac * 25.0;
        const R_mm = R0_mm + X_mm * (a_mm / b_mm);
        const Fc = m * omega * omega * (R_mm / 1000);
        const F_spring = Math.max(0, 2 * Fc * (a_mm / b_mm) - (m1 + m2) * G);

        const scaleMM = this.parts.scaleMM || (1.0 / 85.0);
        const fulcrumR = this.parts.fulcrumR;
        const fulcrumY = this.parts.fulcrumY;

        // Sleeve moves UP along spindle as speed increases, compressing spring against topCap
        const sleeveBaseY = 1.95;
        const sleeveLiftVis = (X_mm * scaleMM) * 2.2; // amplified cleanly for visual clarity
        const ySleeve = sleeveBaseY + sleeveLiftVis;

        if (this.parts.sleeve) {
            this.parts.sleeve.position.y = ySleeve;
        }

        // Spring compresses between topCapY and ySleeve + 0.12
        if (this.parts.springGroup) {
            const topY = this.parts.topCapY - 0.05;
            const botY = ySleeve + 0.12;
            const springLen = Math.max(0.35, topY - botY);
            this.parts.springGroup.position.y = topY;
            this.parts.springGroup.scale.set(1, springLen, 1);
        }

        const armVLen = Math.max(0.75, a_mm * scaleMM);
        const dR_vis = Math.max(0, (R_mm - R0_mm) * scaleMM * 2.5);
        const swingAngle = Math.asin(Math.min(0.75, dR_vis / armVLen));

        let ballY = fulcrumY + armVLen;
        let ballR = fulcrumR;

        for (let i = 0; i < 2; i++) {
            const sign = i === 0 ? 1 : -1;
            const pFulcrum = new THREE.Vector3(sign * fulcrumR, fulcrumY, 0);
            const pSleeveEdge = new THREE.Vector3(sign * 0.25, ySleeve, 0);
            const pBall = new THREE.Vector3(
                sign * (fulcrumR + armVLen * Math.sin(swingAngle)),
                fulcrumY + armVLen * Math.cos(swingAngle),
                0
            );

            this._placeRodBetween(this.parts.bellArmsH[i], pSleeveEdge, pFulcrum);
            this._placeRodBetween(this.parts.bellArmsV[i], pFulcrum, pBall);
            this.parts.balls[i].position.copy(pBall);

            ballY = pBall.y;
            ballR = Math.abs(pBall.x);

            const arrow = this.parts.forceArrows[i];
            if (Fc > 0.2) {
                arrow.visible = true;
                arrow.position.copy(pBall);
                arrow.setDirection(new THREE.Vector3(sign, 0, 0));
                arrow.setLength(Math.min(1.2, 0.22 + Fc * 0.015), 0.14, 0.08);
            } else {
                arrow.visible = false;
            }
        }

        if (this.parts.ring) {
            this.parts.ring.visible = true;
            this.parts.ring.position.y = ballY;
            this.parts.ring.scale.set(ballR, 1, ballR);
        }

        const stateText = N <= Nmin ? 'Pre-Compression (Min Radius)' : (N >= Nmax ? 'Max Spring Compression' : 'Spring-Controlled Equilibrium');
        this.updateInfoDisplay({
            N, omega, R: R_mm, X: X_mm, Fc, F_spring, stateText
        });
    }

    updateInfoDisplay(d) {
        if (this._suppressHud) return;
        this.latestState = { ...d, type: this.governorType };
        const infoEl = document.getElementById('twin-info');
        if (!infoEl) return;

        let chips = [
            `<span class="hud-chip"><strong>Speed:</strong> ${d.N.toFixed(0)} rpm</span>`,
            `<span class="hud-chip"><strong>ω:</strong> ${d.omega.toFixed(2)} rad/s</span>`
        ];

        if (this.governorType === 'hartnell') {
            chips.push(`<span class="hud-chip"><strong>Radius R:</strong> ${d.R.toFixed(2)} mm</span>`);
            chips.push(`<span class="hud-chip"><strong>Sleeve X:</strong> ${d.X.toFixed(2)} mm</span>`);
            chips.push(`<span class="hud-chip"><strong>Fc:</strong> ${d.Fc.toFixed(2)} N</span>`);
            chips.push(`<span class="hud-chip"><strong>Spring S:</strong> ${d.F_spring.toFixed(2)} N</span>`);
        } else {
            chips.push(`<span class="hud-chip"><strong>Height h:</strong> ${d.h.toFixed(1)} mm</span>`);
            chips.push(`<span class="hud-chip"><strong>Radius r:</strong> ${d.r.toFixed(1)} mm</span>`);
            chips.push(`<span class="hud-chip"><strong>Fc:</strong> ${d.Fc.toFixed(2)} N</span>`);
            if (d.lift !== undefined) {
                chips.push(`<span class="hud-chip"><strong>Sleeve Lift:</strong> ${d.lift.toFixed(1)} mm</span>`);
            }
        }

        chips.push(`<span class="hud-state">${d.stateText}</span>`);
        infoEl.innerHTML = chips.join('');
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Smooth Apple-like inertia easing toward target speed
        if (Math.abs(this.speed - this.visualSpeed) > 0.08) {
            this.visualSpeed += (this.speed - this.visualSpeed) * 0.16;
            this._suppressHud = true;
            this.updateGovernor(this.visualSpeed);
            this._suppressHud = false;
        } else if (this.visualSpeed !== this.speed) {
            this.visualSpeed = this.speed;
            this._suppressHud = true;
            this.updateGovernor(this.visualSpeed);
            this._suppressHud = false;
        }

        if (this.parts.rotGroup && this.visualSpeed > 0 && !this.paused) {
            const rotSpeed = (this.visualSpeed / 60) * 0.09;
            this.rotationAngle += rotSpeed;
            this.parts.rotGroup.rotation.y = this.rotationAngle;
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}


// ──── Global Initialization & Bridge ────

let virtualTwin = null;

function initVirtualTwin() {
    virtualTwin = new GovernorVirtualTwin('twin-canvas-container');
    window.virtualTwin = virtualTwin;
}

function setTwinGovernor(type, params = {}) {
    if (!virtualTwin) initVirtualTwin();
    if (virtualTwin) {
        const Nmax = parseFloat(params.N_max || (type === 'hartnell' ? 350 : 300));
        virtualTwin.maxSpeed = Math.max(400, Math.ceil(Nmax * 1.25 / 50) * 50);
        virtualTwin.setGovernor(type, params);
        const sec = document.getElementById('virtual-twin-section');
        if (sec) sec.style.display = '';
    }
}

function updateTwinParams(params = {}) {
    if (virtualTwin) {
        const Nmax = parseFloat(params.N_max || 300);
        virtualTwin.maxSpeed = Math.max(400, Math.ceil(Nmax * 1.25 / 50) * 50);
        virtualTwin.updateParams(params);
    }
}

function setTwinSpeed(rpm) {
    if (virtualTwin) {
        virtualTwin.setSpeed(rpm);
    }
}

window.initVirtualTwin = initVirtualTwin;
window.setTwinGovernor = setTwinGovernor;
window.updateTwinParams = updateTwinParams;
window.setTwinSpeed = setTwinSpeed;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVirtualTwin);
} else {
    initVirtualTwin();
}
