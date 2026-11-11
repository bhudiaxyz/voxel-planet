/**
 * The sky model is authored with +Y up; on the sphere every lookup is rotated
 * by _toSky (sky.ts) so the viewer's local up maps to +Y. This mirrors that
 * GLSL in JS and checks the mapping. Run: npm run check
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type V = [number, number, number];
const norm = (v: V): V => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Guard: the shader must still use the axis this test models.
const src = readFileSync(new URL('../src/render/sky.ts', import.meta.url), 'utf8');
assert.ok(src.includes('vec3 axis = normalize(vec3(-up.z, 0.0, up.x));'), 'sky.ts _toSky axis changed — update this check');

function toSky(v: V, upIn: V): V {
    const up = norm(upIn), c = up[1];
    if (c > 0.99999) return v;
    if (c < -0.99999) return [v[0], -v[1], -v[2]];
    const axis = norm([-up[2], 0, up[0]]), s = Math.sqrt(1 - c * c), cr = cross(axis, v), d = dot(axis, v);
    return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + axis[i] * d * (1 - c)) as V;
}

for (let i = 0; i < 2000; i++) {
    const up = norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
    const r = toSky(up, up);
    assert.ok(Math.hypot(r[0], r[1] - 1, r[2]) < 1e-9, `up ${up} should map to +Y, got ${r}`);
    // A horizontal direction (perpendicular to up) must stay on the horizon (y = 0).
    const h = norm(cross(up, [0.3, 0.7, 0.2]));
    assert.ok(Math.abs(toSky(h, up)[1]) < 1e-9, 'horizontal stays on the horizon');
}
console.log('sky frame ok');
