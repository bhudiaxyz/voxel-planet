/**
 * Drifting voxel clouds in the player's local sky.
 *
 * Each cloud is a cluster of flat boxes (one merged geometry, instanced), laid
 * out on a disc in the tangent plane above the player and wrapped around it,
 * so the sky overhead is always populated wherever you stand on the planet.
 * They drift with the wind in the vertex shader. One draw call.
 *
 * Shaded with a simple top-lit ramp so they read as volumes from below, and
 * fogged so the far ones melt into the haze.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const RADIUS = 180; // disc radius around the player (world units)
const HEIGHT_MIN = 70,
    HEIGHT_MAX = 110;

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aCloud;   // (x, y) on the disc, z = height
  attribute vec2 aShape;   // (scale, yaw)
  uniform vec3 uCentre, uE1, uE2, uUp;
  uniform vec2 uDrift;     // accumulated wind drift on the disc
  uniform float uRadius;
  varying float vShade;
  varying float vEdge;
  void main() {
    // Wrap the drifting position back onto the disc (a torus wrap of the square
    // that contains it), then fade clouds out near the rim instead of popping.
    vec2 xy = aCloud.xy + uDrift;
    xy = mod(xy + uRadius, 2.0 * uRadius) - uRadius;
    float rim = length(xy) / uRadius;
    vEdge = 1.0 - smoothstep(0.78, 1.0, rim);
    float c = cos(aShape.y), s = sin(aShape.y);
    vec3 p = position * aShape.x;
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    vec3 world = uCentre + uE1 * (xy.x + p.x) + uE2 * (xy.y + p.z) + uUp * (aCloud.z + p.y);
    // Top faces bright, sides mid, undersides shaded.
    vShade = normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.74 : 0.88;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    #ifdef USE_FOG
      vFogDepth = -mv.z;
    #endif
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uColor, uShadow;
  uniform float uOpacity;
  varying float vShade;
  varying float vEdge;
  void main() {
    vec3 col = mix(uShadow, uColor, vShade);
    gl_FragColor = vec4(col, uOpacity * vEdge);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Cloud-shadow coverage: the same clouds seen straight down from above the
 * player, written as coverage (red) into a small target. The post pass casts
 * each ground/water pixel up along the sun to the cloud layer and samples this,
 * so shadows match the real clouds' shapes and drift with them.
 */
const SHADOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vEdge;
  void main() { gl_FragColor = vec4(uOpacity * vEdge, 0.0, 0.0, 1.0); }
`;
/** Coverage map resolution, and the mean cloud-layer height the shadow pass projects to. */
const SHADOW_RES = 256;
export const CLOUD_LAYER_H = (HEIGHT_MIN + HEIGHT_MAX) / 2;

/** A handful of flat boxes stacked into a puffy voxel cloud, centred near the origin. */
function cloudShape(rnd: () => number) {
    const parts: THREE.BufferGeometry[] = [];
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
        const w = 6 + rnd() * 10,
            d = 5 + rnd() * 8,
            h = 2 + rnd() * 2.5;
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate((rnd() - 0.5) * 14, i === 0 ? 0 : rnd() * 2.5, (rnd() - 0.5) * 10);
        parts.push(g);
    }
    const merged = mergeGeometries(parts)!;
    for (const g of parts) g.dispose();
    return merged;
}

export function createClouds(scene: THREE.Scene, count: number, seed = 7) {
    if (count <= 0)
        return {
            shadow: null,
            update() {},
            renderShadow() {
                return null;
            },
            setColors() {},
            dispose() {},
        };
    let s = seed >>> 0 || 1;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;

    // Three shapes, instanced: enough variety that repeats don't read.
    const shapes = [cloudShape(rnd), cloudShape(rnd), cloudShape(rnd)];
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uCentre: { value: new THREE.Vector3() },
            uE1: { value: new THREE.Vector3(1, 0, 0) },
            uE2: { value: new THREE.Vector3(0, 0, 1) },
            uUp: { value: new THREE.Vector3(0, 1, 0) },
            uDrift: { value: new THREE.Vector2() },
            uRadius: { value: RADIUS },
            uColor: { value: new THREE.Color(0xfbf4ec) },
            uShadow: { value: new THREE.Color(0xb3a6bc) },
            uOpacity: { value: 0.92 },
        },
    ]);
    const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        fog: true,
        transparent: true,
        depthWrite: false,
    });

    // Shadow coverage: same vertex shader, coverage-only fragment, max-blended so
    // overlapping boxes don't over-darken.
    const shadowMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: SHADOW_FRAG,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
    });
    const shadowTarget = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, {
        type: THREE.UnsignedByteType,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        depthBuffer: false,
    });
    // Looks straight down the local up from above the cloud layer; the view spans
    // the whole wrapped disc (±RADIUS on both tangent axes).
    const shadowCam = new THREE.OrthographicCamera(-RADIUS, RADIUS, RADIUS, -RADIUS, 1, 600);
    const shadowScene = new THREE.Scene();

    const group = new THREE.Group();
    group.name = 'clouds';
    group.matrixAutoUpdate = false;
    const per = Math.ceil(count / shapes.length);
    for (const shape of shapes) {
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = shape.index;
        geo.setAttribute('position', shape.attributes.position);
        geo.setAttribute('normal', shape.attributes.normal);
        const c = new Float32Array(per * 3),
            sh = new Float32Array(per * 2);
        for (let i = 0; i < per; i++) {
            c[i * 3] = (rnd() * 2 - 1) * RADIUS;
            c[i * 3 + 1] = (rnd() * 2 - 1) * RADIUS;
            c[i * 3 + 2] = HEIGHT_MIN + rnd() * (HEIGHT_MAX - HEIGHT_MIN);
            sh[i * 2] = 1.3 + rnd() * 1.4;
            sh[i * 2 + 1] = rnd() * Math.PI * 2;
        }
        geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(c, 3));
        geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(sh, 2));
        geo.instanceCount = per;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        const sm = new THREE.Mesh(geo, shadowMat);
        sm.frustumCulled = false;
        sm.matrixAutoUpdate = false;
        shadowScene.add(sm);
    }
    scene.add(group);

    const frameRef = new THREE.Vector3();
    /** Live references the post pass binds once (values update in place). */
    const shadow = {
        map: shadowTarget.texture,
        centre: uniforms.uCentre.value,
        e1: uniforms.uE1.value,
        e2: uniforms.uE2.value,
        up: uniforms.uUp.value,
        radius: RADIUS,
        layerH: CLOUD_LAYER_H,
    };
    return {
        shadow,
        /**
         * @param playerPos  player world position — the cloud disc is centred above it
         * @param windDir    2D wind direction (shared with the vegetation sway)
         */
        update(dt: number, playerPos: THREE.Vector3, windDir: THREE.Vector2) {
            const up = uniforms.uUp.value.copy(playerPos).normalize();
            // A stable tangent frame: project a fixed reference so the clouds don't
            // spin as the player turns (only drift moves them).
            frameRef.set(0, 1, 0);
            if (Math.abs(up.y) > 0.9) frameRef.set(1, 0, 0);
            const e1 = uniforms.uE1.value.copy(frameRef).addScaledVector(up, -frameRef.dot(up)).normalize();
            uniforms.uE2.value.crossVectors(up, e1);
            uniforms.uCentre.value.copy(playerPos);
            uniforms.uDrift.value.addScaledVector(windDir, dt * 2.2);
        },
        /**
         * Redraw the cloud-coverage map. Call once per frame after update().
         * Returns what the post pass needs to project into it.
         */
        renderShadow(renderer: THREE.WebGLRenderer) {
            const up = uniforms.uUp.value,
                c = uniforms.uCentre.value;
            // Camera above the disc centre, looking down -up, with e2 as screen-up so
            // texture (x, y) maps onto disc (e1, e2) directly.
            shadowCam.position.copy(c).addScaledVector(up, 400);
            shadowCam.up.copy(uniforms.uE2.value);
            shadowCam.lookAt(c);
            shadowCam.updateMatrixWorld();
            const prevTarget = renderer.getRenderTarget();
            const prevClear = renderer.getClearColor(new THREE.Color());
            const prevAlpha = renderer.getClearAlpha();
            renderer.setRenderTarget(shadowTarget);
            renderer.setClearColor(0x000000, 1);
            renderer.clear(true, false, false);
            renderer.render(shadowScene, shadowCam);
            renderer.setRenderTarget(prevTarget);
            renderer.setClearColor(prevClear, prevAlpha);
            return shadow;
        },
        /** Tint by time of day: lit colour and shadow colour (linear). */
        setColors(lit: THREE.Color, shade: THREE.Color, opacity = 0.92) {
            uniforms.uColor.value.copy(lit);
            uniforms.uShadow.value.copy(shade);
            uniforms.uOpacity.value = opacity;
        },
        dispose() {
            scene.remove(group);
            for (const m of group.children as THREE.Mesh[]) m.geometry.dispose();
            for (const g of shapes) g.dispose();
            mat.dispose();
            shadowMat.dispose();
            shadowTarget.dispose();
        },
    };
}
