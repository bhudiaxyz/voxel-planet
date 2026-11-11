/**
 * Butterflies by day, fireflies at dusk and night, around the player.
 *
 * Each critter has an anchor: a ground point within ~25 units of the player,
 * re-sampled on the CPU about once a second so they follow the player and sit
 * on the real terrain. Around its anchor it loops on a small wandering path in
 * the vertex shader. Butterflies are two hinged wing quads in flower colours;
 * fireflies are soft additive points that blink, so the bloom pass catches
 * them. One instanced draw each; both fade with the night factor.
 */
import * as THREE from 'three';
import { BLOCKS } from '../core/palette';

const SPREAD = 14; // anchors are scattered within this of the player — close enough to read
const RESAMPLE = 1.1; // seconds between anchor refreshes (a few per frame)

/*
 * Butterfly model, in a local frame: x = out along the wing (0 at the body),
 * z = along the body (+ = head), y = up. Built by butterflyGeometry():
 *   aPart  0 = body, 1 = forewing, 2 = hindwing
 *   aSide  -1 left, +1 right (0 for the body)
 *   uv     wing-panel coordinates (x: root→tip, y: trailing→leading edge)
 * Each wing panel hinges at x = 0 and rotates about the body axis, so the two
 * sides fold into a real V instead of bending one flat sheet.
 */
const BUTTERFLY_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aAnchor;  // ground point (world)
  attribute vec3 aSeed;    // (phase, speed, radius)
  attribute vec3 aColor;
  attribute float aPart;
  attribute float aSide;
  uniform float uTime, uAlpha;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vPart;
  varying float vShade;
  void main() {
    vUv = uv;
    vCol = aColor;
    vPart = aPart;
    vec3 up = normalize(aAnchor);
    vec3 t1 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(up, t1);
    float tt = uTime * aSeed.y + aSeed.x * 6.28318;

    // Flight path: a Lissajous wander around the anchor, 1.9–3.1 above the ground.
    vec2 w = vec2(sin(tt * 0.7), sin(tt * 1.1 + 1.3)) * aSeed.z;
    vec2 wv = vec2(cos(tt * 0.7) * 0.7, cos(tt * 1.1 + 1.3) * 1.1) * aSeed.z; // its derivative
    vec2 wa = vec2(-sin(tt * 0.7) * 0.49, -sin(tt * 1.1 + 1.3) * 1.21) * aSeed.z;
    float h = 2.5 + sin(tt * 1.7) * 0.6;

    // Flap in bursts with short glides: real butterflies don't beat continuously.
    float burst = smoothstep(-0.3, 0.3, sin(uTime * 1.3 * aSeed.y + aSeed.x * 17.0));
    float beat = uTime * 19.0 + aSeed.x * 40.0;
    float flap = mix(0.25, 0.15 + 0.95 * (0.5 + 0.5 * sin(beat)), burst); // 0 = flat, up to ~1.1 rad
    // Each downstroke lifts the body a little.
    h += sin(beat) * 0.05 * burst;

    vec3 heading = normalize(t1 * wv.x + t2 * wv.y + up * 1e-3);
    vec3 right = normalize(cross(heading, up));
    // Bank into turns: lateral acceleration tilts the wings' rest plane.
    float turn = clamp(dot(t1 * wa.x + t2 * wa.y, right) * 0.35, -0.5, 0.5);
    vec3 bankedUp = normalize(up + right * turn);
    vec3 bankedRight = normalize(cross(heading, bankedUp));

    vec3 p = position;
    vec3 local;
    if (aPart < 0.5) {
      // Body: slim, along the heading.
      local = bankedRight * p.x + bankedUp * p.y + heading * p.z;
      vShade = 0.55;
    } else {
      // Wings rotate about the body axis by the flap angle (both sides up together).
      float a = flap;
      float span = p.x;                         // distance from the body (>= 0)
      local = bankedRight * (aSide * span * cos(a)) + bankedUp * (span * sin(a)) + heading * p.z;
      // Shade by how much the wing faces the sky: tilted-up wings catch less top light.
      vShade = 0.75 + 0.25 * cos(a);
    }
    vec3 world = aAnchor + up * h + t1 * w.x + t2 * w.y + local;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
  }
`;

const BUTTERFLY_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uAlpha;
  varying vec3 vCol;
  varying vec2 vUv;
  varying float vPart;
  varying float vShade;
  void main() {
    vec3 col;
    if (vPart < 0.5) {
      col = vec3(0.10, 0.08, 0.07);              // dark body
    } else {
      // Wing silhouette: a rounded panel; forewings are longer and pointed at the tip.
      vec2 q = vUv;                               // x: root(0)→tip(1), y: 0..1 across
      float fore = step(vPart, 1.5);
      vec2 c = vec2(0.5, 0.5);
      vec2 d = (q - c) * vec2(1.0, mix(1.25, 1.0, fore));
      float r = length(d) + fore * max(0.0, q.x - 0.7) * 0.6 * (0.5 - abs(q.y - 0.55));
      if (r > 0.5) discard;
      // Colour: wing base, darker at the root and rim, pale veins, one eyespot.
      float rim = smoothstep(0.38, 0.5, r);
      float root = 1.0 - smoothstep(0.0, 0.35, q.x);
      float veins = smoothstep(0.92, 1.0, abs(sin((q.y - 0.5) * 14.0 + q.x * 3.0)));
      vec2 eyeAt = fore > 0.5 ? vec2(0.66, 0.6) : vec2(0.55, 0.42);
      float eye = 1.0 - smoothstep(0.06, 0.09, length(q - eyeAt));
      float pupil = 1.0 - smoothstep(0.025, 0.04, length(q - eyeAt));
      col = vCol * (gl_FrontFacing ? 1.0 : 0.72);  // underside duller, like real wings
      col = mix(col, col * 0.45, root * 0.6);
      col = mix(col, vec3(0.12, 0.09, 0.08), rim * 0.85);
      col = mix(col, col * 1.25 + 0.05, veins * 0.35);
      col = mix(col, vec3(0.98, 0.94, 0.85), eye * 0.9);
      col = mix(col, vec3(0.10, 0.07, 0.06), pupil);
      col *= vShade;
    }
    gl_FragColor = vec4(col, uAlpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * One butterfly: a body plus forewing and hindwing on each side. Wings are
 * separate panels rooted at the body, so they fold about the body axis.
 * Wingspan about 1.6 units, so it reads at 5–14 units without looking huge.
 */
function butterflyGeometry() {
    const pos: number[] = [],
        uv: number[] = [],
        part: number[] = [],
        side: number[] = [],
        idx: number[] = [];
    const quad = (
        corners: Array<[number, number, number]>,
        uvs: Array<[number, number]>,
        partId: number,
        sideId: number,
    ) => {
        const base = pos.length / 3;
        for (let i = 0; i < 4; i++) {
            pos.push(...corners[i]);
            uv.push(...uvs[i]);
            part.push(partId);
            side.push(sideId);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const U: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const s of [-1, 1]) {
        // Forewing: rooted near the front of the body, sweeping forward and out.
        quad([[0, 0, -0.02], [0.8, 0, 0.12], [0.8, 0, 0.58], [0, 0, 0.18]], U, 1, s);
        // Hindwing: rooted behind, smaller and rounder, trailing back.
        quad([[0, 0, -0.32], [0.58, 0, -0.42], [0.58, 0, 0.04], [0, 0, -0.04]], U, 2, s);
    }
    // Body: a thin vertical slab along the heading (two crossed quads so it has width from any side).
    quad([[-0.035, 0, -0.38], [0.035, 0, -0.38], [0.035, 0, 0.3], [-0.035, 0, 0.3]], U, 0, 0);
    quad([[0, -0.035, -0.38], [0, 0.035, -0.38], [0, 0.035, 0.3], [0, -0.035, 0.3]], U, 0, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setIndex(idx);
    return g;
}

const FIREFLY_VERT = /* glsl */ `
  #include <common>
  attribute vec3 aAnchor;
  attribute vec3 aSeed;
  uniform float uTime, uSize, uPixelRatio;
  varying float vGlow;
  void main() {
    vec3 up = normalize(aAnchor);
    vec3 t1 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(up, t1);
    float tt = uTime * aSeed.y * 0.35 + aSeed.x * 6.28318;
    vec3 world = aAnchor + up * (0.5 + 0.9 * (0.5 + 0.5 * sin(tt * 0.8)))
               + t1 * sin(tt * 0.6) * aSeed.z + t2 * cos(tt * 0.45) * aSeed.z;
    // Slow blink: on for a while, off for a while, each on its own clock.
    float b = sin(uTime * (0.6 + aSeed.y * 0.5) + aSeed.x * 31.0);
    vGlow = smoothstep(0.1, 0.8, b);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (40.0 / max(-mv.z, 1.0));
  }
`;

const FIREFLY_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * vGlow * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * (1.0 + 2.0 * (1.0 - d)), a);
  }
`;

export interface GroundSampler {
    /** World radius of the walkable ground under a direction, or -1 for water. */
    groundAt(dir: THREE.Vector3): number;
}

export function createCritters(scene: THREE.Scene, count: number, sampler: GroundSampler, seed = 3) {
    if (count <= 0) return { update() {}, dispose() {} };
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

    // ---- butterflies --------------------------------------------------------
    const bGeo = butterflyGeometry();
    const bAnchor = new Float32Array(count * 3);
    const bSeed = new Float32Array(count * 3);
    const bCol = new Float32Array(count * 3);
    const flowerCols = [BLOCKS.LEAF_PINK, BLOCKS.LEAF_LILAC, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_ROSE, BLOCKS.LEAF_BLUSH].map(
        (b: any) => b.top as THREE.Color,
    );
    for (let i = 0; i < count; i++) {
        bSeed[i * 3] = rnd();
        bSeed[i * 3 + 1] = 0.6 + rnd() * 0.8;
        bSeed[i * 3 + 2] = 1.2 + rnd() * 2.5;
    }
    bGeo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(bAnchor, 3));
    bGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(bSeed, 3));
    bGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(bCol, 3));
    bGeo.instanceCount = count;
    bGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const bUni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAlpha: { value: 1 } }]);
    const bMat = new THREE.ShaderMaterial({
        vertexShader: BUTTERFLY_VERT,
        fragmentShader: BUTTERFLY_FRAG,
        uniforms: bUni,
        fog: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const bMesh = new THREE.Mesh(bGeo, bMat);
    bMesh.name = 'butterflies';
    bMesh.frustumCulled = false;
    bMesh.matrixAutoUpdate = false;
    bMesh.renderOrder = 18;
    scene.add(bMesh);

    // ---- fireflies ----------------------------------------------------------
    const fCount = count * 2;
    const fGeo = new THREE.BufferGeometry();
    const fAnchor = new Float32Array(fCount * 3);
    const fSeed = new Float32Array(fCount * 3);
    for (let i = 0; i < fCount; i++) {
        fSeed[i * 3] = rnd();
        fSeed[i * 3 + 1] = 0.5 + rnd();
        fSeed[i * 3 + 2] = 0.8 + rnd() * 2.2;
    }
    fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fCount * 3), 3));
    fGeo.setAttribute('aAnchor', new THREE.BufferAttribute(fAnchor, 3));
    fGeo.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 3));
    fGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const fUni = {
        uTime: { value: 0 },
        uSize: { value: 0.32 },
        uPixelRatio: { value: 1 },
        uColor: { value: new THREE.Color(0xfff2a0) },
        uAlpha: { value: 0 },
    };
    const fMat = new THREE.ShaderMaterial({
        vertexShader: FIREFLY_VERT,
        fragmentShader: FIREFLY_FRAG,
        uniforms: fUni,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const fMesh = new THREE.Points(fGeo, fMat);
    fMesh.name = 'fireflies';
    fMesh.frustumCulled = false;
    fMesh.matrixAutoUpdate = false;
    fMesh.renderOrder = 19;
    scene.add(fMesh);

    // ---- anchors ------------------------------------------------------------
    const _up = new THREE.Vector3(),
        _t1 = new THREE.Vector3(),
        _t2 = new THREE.Vector3(),
        _d = new THREE.Vector3();
    let resampleIdx = 0;
    const total = count + fCount;
    let seeded = false;

    /** Put anchor i on walkable ground near the player; water spots retry a few times. */
    function place(i: number, playerPos: THREE.Vector3) {
        _up.copy(playerPos).normalize();
        _t1.set(0, 1, 0);
        if (Math.abs(_up.y) > 0.95) _t1.set(1, 0, 0);
        _t1.addScaledVector(_up, -_t1.dot(_up)).normalize();
        _t2.crossVectors(_up, _t1);
        const R = playerPos.length();
        for (let tries = 0; tries < 4; tries++) {
            const a = rnd() * Math.PI * 2,
                r = 3 + Math.sqrt(rnd()) * SPREAD;
            _d.copy(_up).multiplyScalar(R).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
            const g = sampler.groundAt(_d);
            if (g < 0) continue;
            const arr = i < count ? bAnchor : fAnchor;
            const j = i < count ? i : i - count;
            arr[j * 3] = _d.x * g;
            arr[j * 3 + 1] = _d.y * g;
            arr[j * 3 + 2] = _d.z * g;
            if (i < count) {
                const c = flowerCols[(rnd() * flowerCols.length) | 0];
                bCol[j * 3] = c.r;
                bCol[j * 3 + 1] = c.g;
                bCol[j * 3 + 2] = c.b;
            }
            return;
        }
    }

    return {
        /**
         * @param night 0 = noon … 1 = midnight. Butterflies fade out from dusk;
         *              fireflies fade in.
         */
        update(dt: number, playerPos: THREE.Vector3, night: number, pixelRatio = 1) {
            bUni.uTime.value += dt;
            fUni.uTime.value += dt;
            fUni.uPixelRatio.value = pixelRatio;
            const day = 1 - THREE.MathUtils.smoothstep(night, 0.35, 0.6);
            bUni.uAlpha.value = day;
            fUni.uAlpha.value = THREE.MathUtils.smoothstep(night, 0.45, 0.75);
            bMesh.visible = day > 0.01;
            fMesh.visible = fUni.uAlpha.value > 0.01;

            if (!seeded) {
                for (let i = 0; i < total; i++) place(i, playerPos);
                seeded = true;
            } else {
                // Refresh a slice of anchors each frame so the whole set turns over every RESAMPLE s.
                const n = Math.min(total, Math.ceil((total * dt) / RESAMPLE));
                for (let k = 0; k < n; k++) {
                    place(resampleIdx, playerPos);
                    resampleIdx = (resampleIdx + 1) % total;
                }
            }
            (bGeo.attributes.aAnchor as THREE.BufferAttribute).needsUpdate = true;
            (bGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
            (fGeo.attributes.aAnchor as THREE.BufferAttribute).needsUpdate = true;
        },
        dispose() {
            scene.remove(bMesh, fMesh);
            bGeo.dispose();
            fGeo.dispose();
            bMat.dispose();
            fMat.dispose();
        },
    };
}
