import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';
import { BLOCK_BY_ID, WATER } from '../core/palette';
import { LandmarkRecord } from '../world/sphere-landmarks';

const SEA_LAYER = 11; // must match sphere-terrain / sphere-landmarks

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

const ICON_FNS: Record<LandmarkRecord['kind'], (ctx: CanvasRenderingContext2D) => void> = {
    spire: iconSpire,
    obelisk: iconObelisk,
    ring: iconRing,
    tombs: iconTombs,
    biosphere: iconBiosphere,
    well: iconWell,
    arch: iconArch,
};

export function createSphereMap(grid: SphereVoxelGrid): SphereMap {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    const ctx = canvas.getContext('2d')!;

    const baked = ctx.createImageData(MAP_W, MAP_H);
    const _dir = new THREE.Vector3();

    function rebake() {
        for (let py = 0; py < MAP_H; py++) {
            const lat = Math.PI / 2 - (py / MAP_H) * Math.PI;
            const cosLat = Math.cos(lat);
            const sinLat = Math.sin(lat);
            for (let px = 0; px < MAP_W; px++) {
                const lon = (px / MAP_W) * 2 * Math.PI - Math.PI;
                _dir.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
                const { face, u, v } = dirToFaceUV(_dir, FACE_RES);
                const top = grid.columnTop(face, u, v);
                let r: number, g: number, b: number;
                if (top <= SEA_LAYER) {
                    // Ocean — blend from shoal to deep based on distance below sea level
                    const depth = SEA_LAYER - top; // 0 = at surface, larger = deeper
                    const waterCol: THREE.Color = depth < 2 ? WATER.shoal : depth < 6 ? WATER.shallow : WATER.deep;
                    r = Math.round(waterCol.r * 255);
                    g = Math.round(waterCol.g * 255);
                    b = Math.round(waterCol.b * 255);
                } else {
                    // Land — use the top block's palette colour (includes foliage)
                    const id = grid.get(face, u, v, top);
                    const block = BLOCK_BY_ID[id] as any;
                    r = 120;
                    g = 120;
                    b = 120;
                    if (block) {
                        const col: THREE.Color = block.mapColor ?? block.top ?? block.side;
                        if (col) {
                            r = Math.round(col.r * 255);
                            g = Math.round(col.g * 255);
                            b = Math.round(col.b * 255);
                        }
                    }
                }
                const i = (py * MAP_W + px) * 4;
                baked.data[i] = r;
                baked.data[i + 1] = g;
                baked.data[i + 2] = b;
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

            const R = 13,
                HEAD = 9.5;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, -R); // tip
            ctx.lineTo(HEAD * 0.5, R * 0.3);
            ctx.lineTo(0, R * 0.1);
            ctx.lineTo(-HEAD * 0.5, R * 0.3);
            ctx.closePath();
            ctx.fillStyle = '#ff4444';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        } else {
            // Stationary — plain dot
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, 2 * Math.PI);
            ctx.fillStyle = '#ff4444';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        if (landmarks) {
            for (const lm of landmarks) {
                const llon = Math.atan2(lm.dir.z, lm.dir.x);
                const llat = Math.asin(Math.max(-1, Math.min(1, lm.dir.y)));
                const lpx = ((llon + Math.PI) / (2 * Math.PI)) * MAP_W;
                const lpy = ((Math.PI / 2 - llat) / Math.PI) * MAP_H;
                ctx.save();
                ctx.translate(lpx, lpy);
                ICON_FNS[lm.kind](ctx);
                ctx.restore();
            }
        }
    }

    const LANDMARK_LABELS: Record<LandmarkRecord['kind'], string> = {
        spire: 'Twisted Spire',
        obelisk: 'Obelisk',
        ring: 'Monolith Ring',
        tombs: 'Tombstone Field',
        biosphere: 'Floating Biosphere',
        well: 'Ancient Well',
        arch: 'Ruined Arch',
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
            tip.textContent = LANDMARK_LABELS[found.kind];
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
