/**
 * Flocks of low-poly birds crossing the local sky.
 *
 * Every 20–60 s a flock of up to `maxBirds` crosses the player's sky along a
 * straight line, left-to-right or right-to-left relative to where the camera
 * faces, 30–48 units up. One instanced draw; wings flap and the flock bobs in
 * the vertex shader, so the CPU only schedules flights and sets a few uniforms.
 *
 * A bird is three triangles: a narrow body and two wings hinged at the body.
 * Unlit, a dark silhouette tinted toward the sky haze with distance — birds
 * against the sky read as shapes, not lit surfaces.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aOffset;   // formation offset: (along, across, up) in flock frame
  attribute vec2 aSeed;     // (flap phase, flap speed scale)
  attribute float aWing;    // 0 = body, ±1 = left/right wing vertex
  uniform vec3 uOrigin;     // flock centre in world space
  uniform vec3 uFwd, uSide, uUp;
  uniform float uTime, uFlap, uScale, uAlpha;
  varying float vAlpha;
  void main() {
    float flap = sin(uTime * uFlap * aSeed.y + aSeed.x * 6.28318);
    vec3 p = position * uScale;
    // Wing tips (aWing != 0, x far from the body) rise and fall about the hinge.
    p.y += aWing * aWing * abs(p.x) * flap * 0.9;
    // Formation: offset, plus a lazy bob so the flock breathes rather than sliding rigidly.
    vec3 o = aOffset;
    o.z += sin(uTime * 0.9 + aSeed.x * 4.0) * 0.6;
    o.y += sin(uTime * 0.6 + aSeed.x * 3.0) * 0.4;
    vec3 local = vec3(p.x, p.y, -p.z) + vec3(o.y, o.z, -o.x);
    // local: x = across (side), y = up, z = along (-forward)
    vec3 world = uOrigin + uSide * local.x + uUp * local.y - uFwd * local.z;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = uAlpha;
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Body along +z (nose), wings along ±x. Units ≈ metres before uScale. */
function birdGeometry() {
    // prettier-ignore
    const pos = [
        // body
        0, 0, 0.55,   -0.08, 0, -0.45,   0.08, 0, -0.45,
        // left wing (hinge at body, tip at -x)
        -0.06, 0, 0.18,   -0.06, 0, -0.18,   -0.85, 0, -0.05,
        // right wing
        0.06, 0, -0.18,   0.06, 0, 0.18,   0.85, 0, -0.05,
    ];
    const wing = [0, 0, 0, -1, -1, -1, 1, 1, 1];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    return g;
}

export function createBirds(scene: THREE.Scene, maxBirds: number, seed = 1) {
    if (maxBirds <= 0) return { update() {}, dispose() {} };

    let s = seed >>> 0 || 1;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const range = (a: number, b: number) => a + (b - a) * rnd();

    const geo = birdGeometry();
    const offsets = new Float32Array(maxBirds * 3);
    const seeds = new Float32Array(maxBirds * 2);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uOrigin: { value: new THREE.Vector3() },
            uFwd: { value: new THREE.Vector3(1, 0, 0) },
            uSide: { value: new THREE.Vector3(0, 0, 1) },
            uUp: { value: new THREE.Vector3(0, 1, 0) },
            uTime: { value: 0 },
            uFlap: { value: 9 },
            uScale: { value: 3.0 },
            uAlpha: { value: 0 },
            uColor: { value: new THREE.Color(0x2b2530) },
        },
    ]);
    const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        fog: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'birds';
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    scene.add(mesh);

    const start = new THREE.Vector3();
    const travel = new THREE.Vector3(); // unit direction of flight (world)
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();
    const _f = new THREE.Vector3();
    let wait = range(4, 12); // first flock comes soon, so it's seen
    let t = 0,
        duration = 0,
        speed = 0,
        span = 0;

    /** Pick a formation and a flight line across the player's local sky. */
    function launch(playerPos: THREE.Vector3, viewFwd: THREE.Vector3) {
        up.copy(playerPos).normalize();
        _f.copy(viewFwd).addScaledVector(up, -viewFwd.dot(up));
        if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0).addScaledVector(up, -up.x);
        _f.normalize();
        side.crossVectors(_f, up).normalize(); // camera right
        const dirSign = rnd() < 0.5 ? 1 : -1; // left→right or right→left
        travel.copy(side).multiplyScalar(dirSign).addScaledVector(_f, range(-0.25, 0.25)).normalize();
        const height = range(30, 48);
        const ahead = range(28, 55); // in front of the player, so the crossing is visible
        span = range(160, 220);
        speed = range(9, 14);
        duration = span / speed;
        start
            .copy(playerPos)
            .addScaledVector(up, height)
            .addScaledVector(_f, ahead)
            .addScaledVector(travel, -span / 2);

        const n = Math.max(3, Math.round(maxBirds * range(0.45, 1)));
        const vee = rnd() < 0.55;
        for (let i = 0; i < n; i++) {
            const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1); // 0, +1, -1, +2, -2…
            if (vee) {
                // V: each bird a step back and to the side of the one ahead
                offsets[i * 3] = -Math.abs(k) * range(2.2, 2.8); // along
                offsets[i * 3 + 1] = k * range(1.8, 2.3); // across
                offsets[i * 3 + 2] = range(-0.4, 0.4); // up
            } else {
                offsets[i * 3] = range(-7, 7);
                offsets[i * 3 + 1] = range(-6, 6);
                offsets[i * 3 + 2] = range(-2.5, 2.5);
            }
            seeds[i * 2] = rnd();
            seeds[i * 2 + 1] = range(0.85, 1.2);
        }
        (geo.attributes.aOffset as THREE.BufferAttribute).needsUpdate = true;
        (geo.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
        geo.instanceCount = n;
        t = 0;
        mesh.visible = true;
    }

    return {
        /**
         * @param playerPos player position in world space (eye or feet)
         * @param viewFwd   camera forward — flocks cross the player's view
         * @param night     0..1 night factor; birds roost at night
         */
        update(dt: number, playerPos: THREE.Vector3, viewFwd: THREE.Vector3, night: number) {
            uniforms.uTime.value += dt;
            if (!mesh.visible) {
                wait -= dt;
                if (wait <= 0 && night < 0.6) launch(playerPos, viewFwd);
                else if (wait <= 0) wait = range(10, 20);
                return;
            }
            t += dt;
            const k = t / duration;
            uniforms.uOrigin.value.copy(start).addScaledVector(travel, t * speed);
            uniforms.uFwd.value.copy(travel);
            uniforms.uUp.value.copy(up);
            uniforms.uSide.value.crossVectors(travel, up).normalize();
            // Fade in/out at the ends of the pass so they don't pop at the frame edge.
            uniforms.uAlpha.value = Math.min(1, k * 8, (1 - k) * 8);
            if (k >= 1) {
                mesh.visible = false;
                wait = range(20, 60);
            }
        },
        dispose() {
            scene.remove(mesh);
            geo.dispose();
            mat.dispose();
        },
    };
}
