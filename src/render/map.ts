import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/voxel';
import { dirToFaceUV } from '../core/geoutil';
import { BLOCK_BY_ID, WATER } from '../core/palette';

/** Player marker: bright orange fill, dark rim (easy to spot on any terrain). */
/** Map colour grading vs raw block tops (linear): a little darker and richer, like in-game. */
const MAP_EXPOSURE = 0.82;
const MAP_SATURATION = 1.15;
const PLAYER_ORANGE = '#ff8c1a';
const PLAYER_RIM = '#3a1a00';
import { LandmarkRecord, LANDMARK_COLOR } from '../world/landmarks';

const SEA_LAYER = 11; // must match world/terrain.ts and world/landmarks.ts

const MAP_W = 1024; // render resolution — keep high for quality
const MAP_H = 512;
const MAP_DISPLAY_W = 971; // CSS display size
const MAP_DISPLAY_H = 486;

export interface SphereMap {
    el: HTMLCanvasElement;
    displayW: number;
    displayH: number;
    update(playerDir: THREE.Vector3, forwardDir?: THREE.Vector3, landmarks?: LandmarkRecord[]): void;
    /** Re-bake the terrain image from current palette colours. Call after setVoxelPalette(). */
    rebake(): void;
    dispose(): void;
}

// Icon draw functions — each receives a pre-translated/scaled ctx with origin at icon centre
const ICON_R = 8; // icon radius in map pixels

function iconSpire(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.moveTo(0, -ICON_R);
    ctx.lineTo(ICON_R * 0.6, ICON_R * 0.7);
    ctx.lineTo(-ICON_R * 0.6, ICON_R * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#c8b4e0';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}
function iconObelisk(ctx: CanvasRenderingContext2D) {
    const w = ICON_R * 0.5,
        h = ICON_R * 1.1;
    ctx.beginPath();
    ctx.moveTo(-w * 0.6, h);
    ctx.lineTo(w * 0.6, h);
    ctx.lineTo(w * 0.3, -h);
    ctx.lineTo(-w * 0.3, -h);
    ctx.closePath();
    ctx.fillStyle = '#b0c8e0';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}
function iconRing(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.arc(0, 0, ICON_R, 0, Math.PI * 2);
    ctx.strokeStyle = '#e0d8a0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, ICON_R * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#e0d8a0';
    ctx.fill();
}
function iconTombs(ctx: CanvasRenderingContext2D) {
    const s = ICON_R * 0.7;
    for (const [ox, oy] of [
        [-s, s * 0.3],
        [0, -s * 0.2],
        [s, s * 0.5],
    ]) {
        ctx.fillStyle = '#c0b8b0';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.rect(ox - 1.5, oy - s * 0.7, 3, s);
        ctx.fill();
        ctx.stroke();
    }
}
function iconBiosphere(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.arc(0, 0, ICON_R, 0, Math.PI * 2);
    ctx.fillStyle = '#90d090';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -ICON_R * 0.25, ICON_R * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#5a9060';
    ctx.fill();
}
function iconWell(ctx: CanvasRenderingContext2D) {
    const s = ICON_R * 0.8;
    ctx.strokeStyle = '#d0c8b0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-s, -s * 0.7, s * 2, s * 1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s * 0.7);
    ctx.lineTo(0, -s * 1.3);
    ctx.lineTo(s * 0.6, -s * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#8090a8';
    ctx.fill();
}
function iconZiggurat(ctx: CanvasRenderingContext2D) {
    const s = ICON_R;
    for (let t = 0; t < 3; t++) {
        const w = s * (1.6 - t * 0.5),
            y = s * (0.6 - t * 0.55);
        ctx.fillRect(-w / 2, y - s * 0.45, w, s * 0.45);
    }
}
function iconTower(ctx: CanvasRenderingContext2D) {
    const s = ICON_R;
    ctx.fillRect(-s * 0.4, -s * 0.8, s * 0.8, s * 1.6);
    // Crenellations
    for (const x of [-0.4, 0, 0.4]) ctx.fillRect(x * s - s * 0.12, -s * 1.05, s * 0.24, s * 0.3);
}
function iconGrove(ctx: CanvasRenderingContext2D) {
    const s = ICON_R;
    for (const [x, h] of [
        [-0.55, 0.9],
        [0, 1.3],
        [0.55, 1.0],
    ]) {
        ctx.beginPath();
        ctx.moveTo(x * s, -h * s * 0.8);
        ctx.lineTo(x * s + s * 0.22, s * 0.7);
        ctx.lineTo(x * s - s * 0.22, s * 0.7);
        ctx.closePath();
        ctx.fill();
    }
}
function iconAqueduct(ctx: CanvasRenderingContext2D) {
    const s = ICON_R;
    ctx.fillRect(-s * 1.1, -s * 0.55, s * 2.2, s * 0.35);
    ctx.lineWidth = s * 0.28;
    for (const x of [-0.6, 0.6]) {
        ctx.beginPath();
        ctx.arc(x * s, s * 0.6, s * 0.42, Math.PI, 0);
        ctx.stroke();
    }
}
function iconArch(ctx: CanvasRenderingContext2D) {
    const w = ICON_R,
        h = ICON_R * 1.1,
        pw = ICON_R * 0.32;
    ctx.fillStyle = '#c0b8b0';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    // Left pillar
    ctx.beginPath();
    ctx.rect(-w, -h * 0.2, pw, h);
    ctx.fill();
    ctx.stroke();
    // Right pillar
    ctx.beginPath();
    ctx.rect(w - pw, -h * 0.2, pw, h);
    ctx.fill();
    ctx.stroke();
    // Lintel (partial — missing centre block)
    ctx.beginPath();
    ctx.rect(-w, -h * 0.2 - pw, w * 0.55, pw);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(w * 0.45 - pw, -h * 0.2 - pw, w * 0.55, pw);
    ctx.fill();
    ctx.stroke();
}

const GLYPHS: Record<LandmarkRecord['kind'], (ctx: CanvasRenderingContext2D) => void> = {
    spire: iconSpire,
    obelisk: iconObelisk,
    ring: iconRing,
    tombs: iconTombs,
    biosphere: iconBiosphere,
    well: iconWell,
    arch: iconArch,
    ziggurat: iconZiggurat,
    tower: iconTower,
    grove: iconGrove,
    aqueduct: iconAqueduct,
};

/** One saturated, clearly different colour per landmark kind (badge fill). */
const BADGE = Object.fromEntries(
    Object.entries(LANDMARK_COLOR).map(([k, hex]) => [k, '#' + hex.toString(16).padStart(6, '0')]),
) as Record<LandmarkRecord['kind'], string>;
const BADGE_R = ICON_R * 1.35;

/**
 * Landmark marker: a bright coloured badge with a dark rim and a soft glow,
 * the kind's glyph drawn in white on top. The glyph functions pick their own
 * pastel colours; those are forced to white here so every glyph reads on its
 * badge, and the badges carry the colour coding instead.
 */
function drawBadge(ctx: CanvasRenderingContext2D, kind: LandmarkRecord['kind']) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(0, 0, BADGE_R, 0, Math.PI * 2);
    ctx.fillStyle = BADGE[kind];
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1b1424';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, BADGE_R - 1.6, 0, Math.PI * 2);
    ctx.stroke();
    // Glyph in white: lock fill/stroke colour while the glyph draws.
    ctx.scale(0.78, 0.78);
    const white = '#ffffff';
    ctx.fillStyle = white;
    ctx.strokeStyle = white;
    Object.defineProperty(ctx, 'fillStyle', { configurable: true, get: () => white, set: () => {} });
    Object.defineProperty(ctx, 'strokeStyle', { configurable: true, get: () => white, set: () => {} });
    try {
        GLYPHS[kind](ctx);
    } finally {
        // Remove the own-property overrides; the prototype accessors come back.
        delete (ctx as any).fillStyle;
        delete (ctx as any).strokeStyle;
    }
    ctx.restore();
}

export function createSphereMap(grid: SphereVoxelGrid): SphereMap {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    const ctx = canvas.getContext('2d')!;

    const baked = ctx.createImageData(MAP_W, MAP_H);
    const _dir = new THREE.Vector3();

    /**
     * Bake the planet as the world looks:
     *  - palette colours are linear; the canvas wants sRGB. Writing linear straight
     *    out (as this did) made the map far darker and more saturated than the game.
     *  - land shows its GROUND colour, with canopy only as a gentle tint, so a
     *    forest reads as green land rather than per-tree speckle of six leaf colours;
     *  - soft hill shade from the north-west (sampled a few pixels apart, so 2-layer
     *    terraces read as relief, not noise) and a slight lift with altitude;
     *  - the sea deepens offshore and carries a little sky haze, as it does in-game.
     */
    function rebake() {
        const heights = new Float32Array(MAP_W * MAP_H);
        const cols = new Float32Array(MAP_W * MAP_H * 3);
        const water = new Uint8Array(MAP_W * MAP_H);
        const _c = new THREE.Color();
        const _leaf = new THREE.Color();
        for (let py = 0; py < MAP_H; py++) {
            const lat = Math.PI / 2 - (py / MAP_H) * Math.PI;
            const cosLat = Math.cos(lat);
            const sinLat = Math.sin(lat);
            for (let px = 0; px < MAP_W; px++) {
                const lon = (px / MAP_W) * 2 * Math.PI - Math.PI;
                _dir.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
                const { face, u, v } = dirToFaceUV(_dir, FACE_RES);
                const top = grid.columnTop(face, u, v);
                const k = py * MAP_W + px;
                if (top <= SEA_LAYER) {
                    const depth = SEA_LAYER - top; // bed depth below the surface
                    _c.copy(WATER.shoal).lerp(WATER.shallow, Math.min(1, depth / 3));
                    if (depth > 3) _c.lerp(WATER.deep, Math.min(1, (depth - 3) / 8) * 0.7);
                    // (No haze lerp: with the bluer sky it washed the whole sea pale.)
                    heights[k] = SEA_LAYER;
                    water[k] = 1;
                } else {
                    const ground = grid.groundColumnTop(face, u, v);
                    const gBlock = BLOCK_BY_ID[grid.get(face, u, v, Math.max(0, ground))] as any;
                    const gCol: THREE.Color | undefined = gBlock?.mapColor ?? gBlock?.top ?? gBlock?.side;
                    if (gCol) _c.copy(gCol);
                    else _c.setRGB(0.3, 0.3, 0.3);
                    // Canopy over the ground: a tint toward the leaves, not a replacement.
                    if (top > ground) {
                        const leaf = BLOCK_BY_ID[grid.get(face, u, v, top)] as any;
                        if (leaf?.top) _c.lerp(_leaf.copy(leaf.top).multiplyScalar(0.85), 0.45);
                    }
                    heights[k] = Math.max(ground, SEA_LAYER);
                }
                cols[k * 3] = _c.r;
                cols[k * 3 + 1] = _c.g;
                cols[k * 3 + 2] = _c.b;
            }
        }
        const S = 3; // hill-shade sample spacing, pixels
        for (let py = 0; py < MAP_H; py++) {
            for (let px = 0; px < MAP_W; px++) {
                const k = py * MAP_W + px;
                _c.setRGB(cols[k * 3], cols[k * 3 + 1], cols[k * 3 + 2]);
                if (!water[k]) {
                    const w = heights[py * MAP_W + ((px - S + MAP_W) % MAP_W)];
                    const n = heights[Math.max(0, py - S) * MAP_W + px];
                    const shade = Math.max(0.8, Math.min(1.18, 1 + (heights[k] - w + (heights[k] - n)) * 0.018));
                    const lift = 0.94 + Math.min(0.12, (heights[k] - SEA_LAYER) * 0.006);
                    _c.multiplyScalar(shade * lift);
                }
                // Match the palette as it reads in the world: raw block tops are the
                // colour at full, flat light, but in-game every surface is shaded by
                // sun, AO and haze, so the map looked white-washed beside it. Darken
                // and re-saturate a little, in linear space, before encoding.
                _c.multiplyScalar(MAP_EXPOSURE);
                const lum = 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b;
                _c.setRGB(
                    lum + (_c.r - lum) * MAP_SATURATION,
                    lum + (_c.g - lum) * MAP_SATURATION,
                    lum + (_c.b - lum) * MAP_SATURATION,
                );
                _c.convertLinearToSRGB();
                const i = k * 4;
                baked.data[i] = Math.round(Math.min(1, _c.r) * 255);
                baked.data[i + 1] = Math.round(Math.min(1, _c.g) * 255);
                baked.data[i + 2] = Math.round(Math.min(1, _c.b) * 255);
                baked.data[i + 3] = 255;
            }
        }
    }

    rebake();

    function update(playerDir: THREE.Vector3, forwardDir?: THREE.Vector3, landmarks?: LandmarkRecord[]) {
        ctx.putImageData(baked, 0, 0);

        const lon = Math.atan2(playerDir.z, playerDir.x);
        const lat = Math.asin(Math.max(-1, Math.min(1, playerDir.y)));
        const px = ((lon + Math.PI) / (2 * Math.PI)) * MAP_W;
        const py = ((Math.PI / 2 - lat) / Math.PI) * MAP_H;

        // Landmarks first, the player marker last: the player must always be
        // visible on top of any badge or label near it.
        if (landmarks) {
            labelBoxes.length = 0;
            // Reserve the player's spot so no landmark label is placed over it.
            labelBoxes.push([px - 22, py - 22, 44, 44]);
            for (const lm of landmarks) {
                const llon = Math.atan2(lm.dir.z, lm.dir.x);
                const llat = Math.asin(Math.max(-1, Math.min(1, lm.dir.y)));
                const lpx = ((llon + Math.PI) / (2 * Math.PI)) * MAP_W;
                const lpy = ((Math.PI / 2 - llat) / Math.PI) * MAP_H;
                ctx.save();
                ctx.translate(lpx, lpy);
                drawBadge(ctx, lm.kind);
                ctx.restore();
                drawLabel(lm.name, lpx, lpy);
            }
        }
        if (forwardDir && forwardDir.lengthSq() > 0.001) {
            // Project forward direction onto equirectangular map to get arrow angle
            // Tangent east (+lon) and north (-lat) axes at player position
            const cosLon = Math.cos(lon),
                sinLon = Math.sin(lon);
            const cosLat2 = Math.cos(lat),
                sinLat2 = Math.sin(lat);
            // East unit vector in world space: d(playerDir)/d(lon)
            const eastX = -sinLon * cosLat2,
                eastY = 0,
                eastZ = cosLon * cosLat2;
            // North unit vector in world space: -d(playerDir)/d(lat)
            const northX = -cosLon * sinLat2,
                northY = cosLat2,
                northZ = -sinLon * sinLat2;

            const fwdE = forwardDir.x * eastX + forwardDir.y * eastY + forwardDir.z * eastZ;
            const fwdN = forwardDir.x * northX + forwardDir.y * northY + forwardDir.z * northZ;
            // Map: +x = east (+px), +y = south (-N)
            const angle = Math.atan2(fwdE, fwdN); // angle from north, clockwise

            // Larger than the landmark badges so the player is the first thing you see.
            const R = 20,
                HEAD = 15;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, -R); // tip
            ctx.lineTo(HEAD * 0.5, R * 0.3);
            ctx.lineTo(0, R * 0.1);
            ctx.lineTo(-HEAD * 0.5, R * 0.3);
            ctx.closePath();
            // Bright orange with a soft glow and a dark rim: stands out on pale sand,
            // green land and blue sea alike.
            ctx.shadowColor = 'rgba(255, 140, 26, 0.85)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = PLAYER_ORANGE;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = PLAYER_RIM;
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.restore();
        } else {
            // Stationary — plain dot
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, 2 * Math.PI);
            ctx.shadowColor = 'rgba(255, 140, 26, 0.85)';
            ctx.shadowBlur = 8;
            ctx.fillStyle = PLAYER_ORANGE;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = PLAYER_RIM;
            ctx.lineWidth = 1.6;
            ctx.stroke();
        }

        drawCompass();
    }

    /**
     * N / E / S / W rose in the top-right corner. The map is equirectangular with
     * latitude up, so north is always the top edge and the rose never rotates.
     */
    function drawCompass() {
        const R = 26,
            cx = MAP_W - R - 14,
            cy = R + 14;
        ctx.save();
        ctx.translate(cx, cy);
        // Backing disc
        ctx.beginPath();
        ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20, 16, 28, 0.62)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 248, 236, 0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Four points: north in orange to match the player arrow, the rest pale.
        const point = (a: number, len: number, fill: string) => {
            ctx.save();
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(0, -len);
            ctx.lineTo(4.5, 0);
            ctx.lineTo(0, 3);
            ctx.lineTo(-4.5, 0);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.restore();
        };
        point(Math.PI / 2, R * 0.55, '#d8d0c4');
        point(Math.PI, R * 0.55, '#d8d0c4');
        point(-Math.PI / 2, R * 0.55, '#d8d0c4');
        point(0, R * 0.62, PLAYER_ORANGE);
        // Letters
        ctx.font = '700 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff8ec';
        ctx.fillText('N', 0, -R + 1);
        ctx.fillText('S', 0, R - 1);
        ctx.fillText('E', R - 2, 0);
        ctx.fillText('W', -R + 2, 0);
        ctx.restore();
    }

    /**
     * Always-visible name under a landmark icon, on a dark pill so it reads on
     * sand, grass and sea. Flips above the icon near the bottom edge and is kept
     * inside the map horizontally.
     */
    /** Label rectangles already drawn this frame [x, y, w, h]. */
    const labelBoxes: Array<[number, number, number, number]> = [];
    const overlaps = (x: number, y: number, w: number, h: number) =>
        labelBoxes.some(([bx, by, bw, bh]) => x < bx + bw + 2 && x + w + 2 > bx && y < by + bh + 1 && y + h + 1 > by);

    function drawLabel(text: string, x: number, y: number) {
        ctx.save();
        ctx.font = '600 11px sans-serif';
        const w = ctx.measureText(text).width + 8,
            h = 15;
        const lx = Math.max(2, Math.min(MAP_W - w - 2, x - w / 2));
        // Try below, then above; if both collide with an earlier label, skip it
        // (the badge still shows and the hover tooltip still names it).
        const yBelow = y + 14,
            yAbove = y - 14 - h;
        let ly = -1;
        if (yBelow + h < MAP_H && !overlaps(lx, yBelow, w, h)) ly = yBelow;
        else if (yAbove > 0 && !overlaps(lx, yAbove, w, h)) ly = yAbove;
        if (ly < 0) {
            ctx.restore();
            return;
        }
        labelBoxes.push([lx, ly, w, h]);
        ctx.fillStyle = 'rgba(20, 16, 28, 0.72)';
        ctx.beginPath();
        ctx.roundRect(lx, ly, w, h, 4);
        ctx.fill();
        ctx.fillStyle = '#fff8ec';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lx + 4, ly + h / 2 + 0.5);
        ctx.restore();
    }

    const LANDMARK_LABELS: Record<LandmarkRecord['kind'], string> = {
        spire: 'Twisted Spire',
        obelisk: 'Obelisk',
        ring: 'Monolith Ring',
        tombs: 'Tombstone Field',
        biosphere: 'Floating Biosphere',
        well: 'Ancient Well',
        arch: 'Ruined Arch',
        ziggurat: 'Stepped Ziggurat',
        tower: 'Ruined Watchtower',
        grove: 'Crystal Grove',
        aqueduct: 'Old Aqueduct',
    };

    // Tooltip element
    const tip = document.createElement('div');
    tip.style.cssText =
        'position:fixed;padding:3px 8px;background:rgba(0,0,0,0.75);color:#fff;font:12px/1.4 sans-serif;border-radius:3px;pointer-events:none;display:none;z-index:21;white-space:nowrap;';
    document.body.appendChild(tip);

    let _cachedLandmarks: LandmarkRecord[] = [];

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = MAP_W / rect.width;
        const scaleY = MAP_H / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        const hitR = ICON_R * 2;

        let found: LandmarkRecord | null = null;
        for (const lm of _cachedLandmarks) {
            const llon = Math.atan2(lm.dir.z, lm.dir.x);
            const llat = Math.asin(Math.max(-1, Math.min(1, lm.dir.y)));
            const lpx = ((llon + Math.PI) / (2 * Math.PI)) * MAP_W;
            const lpy = ((Math.PI / 2 - llat) / Math.PI) * MAP_H;
            if (Math.abs(mx - lpx) < hitR && Math.abs(my - lpy) < hitR) {
                found = lm;
                break;
            }
        }
        if (found) {
            tip.textContent = `${found.name} · ${found.sky ? 'Sky Island' : LANDMARK_LABELS[found.kind]}`;
            tip.style.left = e.clientX + 12 + 'px';
            tip.style.top = e.clientY - 4 + 'px';
            tip.style.display = 'block';
        } else {
            tip.style.display = 'none';
        }
    });
    canvas.addEventListener('mouseleave', () => {
        tip.style.display = 'none';
    });

    const _origUpdate = update;
    function updateWithCache(playerDir: THREE.Vector3, forwardDir?: THREE.Vector3, landmarks?: LandmarkRecord[]) {
        if (landmarks) _cachedLandmarks = landmarks;
        _origUpdate(playerDir, forwardDir, landmarks ?? _cachedLandmarks);
    }

    return {
        el: canvas,
        displayW: MAP_DISPLAY_W,
        displayH: MAP_DISPLAY_H,
        update: updateWithCache,
        rebake,
        dispose() {
            tip.remove();
        },
    };
}
