/**
 * Lightweight GPU tier detection.
 *
 * Buckets:
 *   high         — desktop discrete GPU or Apple Silicon Mac
 *   mobile-high  — flagship phone / any recent iPad
 *   mid          — modern integrated laptop GPU, upper-mid phone
 *   low          — older integrated laptop GPU, software rendering
 *   very-low     — old/budget phone, or no WebGL2
 *
 * See classifyGpu() for the reference-device table.
 */

export type GpuTier = 'high' | 'mobile-high' | 'mid' | 'low' | 'very-low';

export interface TierSettings {
    /** Maximum device pixel ratio used for render targets. */
    dprCap: number;
    /** VSM shadow map edge length in pixels. */
    shadowRes: number;
    /** VSM blur sample count — fewer = cheaper on fill-rate-limited mobile. */
    shadowBlurSamples: number;
    /** Shadow frustum half-extent in world units. Smaller = denser texels. */
    shadowExtent: number;
    /** Main camera far plane. Lower = better depth precision, no visible difference with fog. */
    cameraFar: number;
    /** Whether the Unreal bloom pass is added to the composer. */
    bloom: boolean;
    /** Number of AO rosette taps (0 = skip AO entirely). */
    aoTaps: number;
    /** Whether the defocus blur runs in the atmosphere pass. */
    dof: boolean;
    /** Crepuscular ray taps per pixel (0 = disabled, 4 = half, 8 = full). */
    crepuscularTaps: number;
    /** Whether EdgeMaskPass (full second scene render) is added. High-only — it doubles scene draw calls. */
    edgeMask: boolean;
    /** Whether cloud-shadow noise runs in the atmosphere pass. */
    cloudShadow: boolean;
    /** Whether the full night-sky FBM (Milky Way, nebulae) runs. */
    nightSkyFull: boolean;
    /** Anti-aliasing quality. 'smaa' = full SMAA, 'fxaa' = single-pass, 'none' = off. */
    aaQuality: 'smaa' | 'fxaa' | 'none';
    /** Terrain stream radius in chunks (~28 surface units each). The outer quarter dither-fades out. */
    streamRadius: number;
    /** Water plane subdivision (NxN quads). Higher = smoother waves but more vertices. */
    waterSubdivision: number;
    /** Particle instance count for leaves/dust effects. */
    particleCount: number;
    /** Grass tuft coverage, 0..1. Trees are kept at every tier. */
    grassDensity: number;
    /** Max birds per flock (0 = no flocks). Flocks cross the sky every 20-60 s. */
    birdFlock: number;
    /** Voxel cloud count in the local sky (0 = none). */
    clouds: number;
    /** Butterflies by day / fireflies at night, near the player (0 = none). */
    critters: number;
    /** Ground clutter (boulders, logs, mushrooms) density multiplier, 0..1. */
    groundDetail: number;
    /** Animated foam line where the sea meets land. */
    shoreFoam: boolean;
    /** Leaf-cluster shading on tree canopy blocks (instead of flat-coloured cubes). */
    foliageDetail: boolean;
    /** Low-res whole-planet shell beyond the streamed terrain, so the rest of the world shows. */
    farField: boolean;
    /** Drawing-buffer pixel budget in megapixels (DPR is lowered to fit). */
    maxMegapixels: number;
}

//                         dprCap  shadowRes  blurSamples  shadowExtent  cameraFar  bloom   aoTaps  dof    crep  edge   cloud  nightFull  aa       stream  waterSub  particles
export const TIER_SETTINGS: Record<GpuTier, TierSettings> = {
    high: {
        dprCap: 2,
        shadowRes: 3072,
        shadowBlurSamples: 12,
        shadowExtent: 120,
        cameraFar: 6000,
        bloom: true,
        aoTaps: 8,
        dof: true,
        crepuscularTaps: 8,
        edgeMask: true,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 22,
        waterSubdivision: 64,
        particleCount: 1200,
        grassDensity: 1,
        birdFlock: 14,
        clouds: 26,
        critters: 16,
        groundDetail: 1,
        shoreFoam: true,
        foliageDetail: true,
        farField: true,
        maxMegapixels: 4.2,
    },
    'mobile-high': {
        dprCap: 1.5,
        shadowRes: 2048,
        shadowBlurSamples: 8,
        shadowExtent: 110,
        cameraFar: 3000,
        bloom: true,
        aoTaps: 4,
        dof: true,
        crepuscularTaps: 4,
        edgeMask: false,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 16,
        waterSubdivision: 32,
        particleCount: 700,
        grassDensity: 0.7,
        birdFlock: 10,
        clouds: 18,
        critters: 10,
        groundDetail: 0.7,
        shoreFoam: true,
        foliageDetail: true,
        farField: true,
        maxMegapixels: 2.0,
    },
    mid: {
        dprCap: 1.25,
        shadowRes: 2048,
        shadowBlurSamples: 8,
        shadowExtent: 120,
        cameraFar: 3000,
        bloom: true,
        aoTaps: 4,
        dof: true,
        crepuscularTaps: 4,
        edgeMask: false,
        cloudShadow: true,
        nightSkyFull: true,
        aaQuality: 'smaa',
        streamRadius: 17,
        waterSubdivision: 32,
        particleCount: 600,
        grassDensity: 0.8,
        birdFlock: 9,
        clouds: 18,
        critters: 10,
        groundDetail: 0.8,
        shoreFoam: true,
        foliageDetail: true,
        farField: true,
        maxMegapixels: 2.4,
    },
    low: {
        dprCap: 1,
        shadowRes: 1024,
        shadowBlurSamples: 4,
        shadowExtent: 100,
        cameraFar: 1500,
        bloom: false,
        aoTaps: 0,
        dof: false,
        crepuscularTaps: 0,
        edgeMask: false,
        cloudShadow: false,
        nightSkyFull: false,
        aaQuality: 'fxaa',
        streamRadius: 9,
        waterSubdivision: 16,
        particleCount: 200,
        grassDensity: 0.45,
        birdFlock: 0,
        clouds: 10,
        critters: 0,
        groundDetail: 0.45,
        shoreFoam: false,
        foliageDetail: true,
        farField: true,
        maxMegapixels: 1.6,
    },
    'very-low': {
        dprCap: 1,
        shadowRes: 512,
        shadowBlurSamples: 4,
        shadowExtent: 80,
        cameraFar: 1200,
        bloom: false,
        aoTaps: 0,
        dof: false,
        crepuscularTaps: 0,
        edgeMask: false,
        cloudShadow: false,
        nightSkyFull: false,
        aaQuality: 'none',
        streamRadius: 7,
        waterSubdivision: 4,
        particleCount: 0,
        grassDensity: 0.25,
        birdFlock: 0,
        clouds: 0,
        critters: 0,
        groundDetail: 0.25,
        shoreFoam: false,
        foliageDetail: false,
        farField: false,
        maxMegapixels: 1.0,
    },
};

/** What the hardware probe saw — kept for the HUD/debug overlay and for tests. */
export interface GpuProbe {
    renderer: string;
    webgl2: boolean;
    mobile: boolean;
    cores: number;
    memGB: number | undefined;
}

export function probeGpu(): GpuProbe {
    const cores = navigator.hardwareConcurrency || 4;
    const ua = navigator.userAgent;
    // iPadOS 13+ Safari reports a desktop Mac UA; touch points give it away
    // (no Mac has a touchscreen).
    const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    const mobile = iPadOS || /Mobi|Android|iPad|iPhone|iPod/i.test(ua);

    let renderer = '';
    let webgl2 = false;
    try {
        // Same power preference as the real renderer, so a hybrid laptop is tiered
        // on the GPU the game will actually run on (not the iGPU).
        const gl = document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
        if (gl) {
            webgl2 = true;
            // Chrome/Edge/Safari 16+ expose the real renderer string through
            // RENDERER; the debug extension is only needed on older browsers.
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
            // Release the probe context — holding it occupies GPU memory until the tab closes.
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    } catch {
        /* treated as no WebGL2 */
    }
    return { renderer, webgl2, mobile, cores, memGB: (navigator as any).deviceMemory };
}

/**
 * Classify a probe into a tier. Pure, so it can be checked without a browser.
 *
 * The GPU name is the primary signal. MAX_TEXTURE_SIZE was used before, but
 * ANGLE reports 16384 for current Intel/AMD integrated GPUs too, so it no
 * longer separates them from discrete cards. Core count and deviceMemory are
 * secondary — Safari/Firefox omit deviceMemory, so it is only ever used to
 * push a device down, never up.
 *
 * Reference devices (≤7 years old as of 2026):
 *   Desktop RTX/RX/Arc discrete              → high
 *   Apple M-series Mac                        → high
 *   Intel Iris Xe / Arc iGPU / Radeon iGPU    → mid
 *   Intel UHD/HD 6xx (2017–2020 laptops)      → low
 *   iPad (any, A12+/M-series; "Apple GPU")    → mobile-high (A12–A13: still fine at mobile-high caps)
 *   iPhone XS+ ("Apple GPU")                  → mobile-high
 *   Galaxy S22 Ultra (Adreno 730 / Xclipse 920) → mobile-high
 *   Adreno 6xx / Mali-G7x (2019–2021 mid/flagship) → mid
 *   Adreno 5xx / Mali-G5x/T-series, PowerVR   → very-low
 *   No WebGL2                                 → very-low
 */
export function classifyGpu(p: GpuProbe): GpuTier {
    if (!p.webgl2) return 'very-low';
    const r = p.renderer.toLowerCase();
    const weakMem = p.memGB !== undefined && p.memGB <= 2;
    const software = /swiftshader|llvmpipe|software|microsoft basic render/.test(r);
    if (software) return p.mobile ? 'very-low' : 'low';

    if (p.mobile) {
        // Apple first: Safari's hardwareConcurrency isn't the physical core count
        // (it can report 2-4 on capable iPads), so the core cut below would send an
        // A12+ iPad to very-low. Every iOS/iPadOS device with WebGL2 Safari (A12+,
        // 2018+) handles mobile-high; weak-memory devices still drop.
        if (/apple/.test(r)) return weakMem ? 'mid' : 'mobile-high';
        if (weakMem || p.cores <= 4) return 'very-low';
        const adreno = /adreno[^0-9]*(\d{3})/.exec(r);
        if (adreno) {
            const n = +adreno[1];
            // 630/640/650/660 (2018-20 flagships) run mid; budget 610-620s run low.
            return n >= 700 ? 'mobile-high' : n >= 630 ? 'mid' : n >= 610 ? 'low' : 'very-low';
        }
        if (/xclipse|immortalis/.test(r)) return 'mobile-high';
        const mali = /mali-g(\d+)/.exec(r);
        // Valhall G610+ (2022 mid-range, e.g. Dimensity) and the G76-G78 flagships run mid.
        if (mali) return +mali[1] >= 610 || +mali[1] === 78 || +mali[1] === 77 || +mali[1] === 76 ? 'mid' : 'very-low';
        // Unknown mobile GPU: middle of the road beats guessing high.
        return p.cores >= 8 ? 'mid' : 'very-low';
    }

    if (weakMem || p.cores <= 2) return 'low';
    // Older or entry-level discrete GPUs (2-4 GB, ~2014-19): GTX 7xx/9xx/1030-1050,
    // GTX 1630/1650, MX laptop chips, GT-series, RX 550/560, old Quadros. They would
    // match the discrete rule below and get high (radius 22, 3072 VSM, DPR 2).
    if (/gtx ?(7\d\d|9\d\d|10[3-5]0|16[35]0)|\bmx ?\d{2,3}\b|\bgt ?\d{3,4}\b|rx ?5[56]0\b|quadro (k|m|p)\d/.test(r))
        return 'mid';
    // Discrete GPUs and Apple Silicon.
    if (
        /nvidia|geforce|quadro|rtx|radeon (rx|pro)|\brx ?\d{3,4}|apple m\d|apple gpu/.test(r) &&
        !/radeon\(tm\) graphics|vega \d+ graphics/.test(r)
    )
        return p.cores >= 4 ? 'high' : 'mid';
    // Intel Arc discrete (A-series) vs Arc integrated (Core Ultra "Arc(TM) Graphics" / "Arc Pro 1xxT").
    if (/arc\(tm\) a\d{3}/.test(r)) return 'high';
    // Modern integrated: Arc iGPU, Iris Xe, Radeon 680M/780M-class.
    if (/arc|iris\(r\) xe|iris xe|radeon\(tm\) (6|7|8)\d0m|radeon(\(tm\))? graphics/.test(r)) return 'mid';
    // Older Intel UHD/HD and Iris Plus.
    if (/intel/.test(r)) return 'low';
    // Unknown desktop renderer (e.g. masked by privacy settings): fall back to cores.
    return p.cores >= 8 ? 'mid' : 'low';
}

const TIERS: GpuTier[] = ['high', 'mobile-high', 'mid', 'low', 'very-low'];

/**
 * Detect GPU tier. `?tier=<name>` in the URL overrides detection, for testing
 * a phone profile on a desktop or rescuing a misclassified device.
 */
export function detectGpuTier(): GpuTier {
    const forced = new URLSearchParams(location.search).get('tier') as GpuTier | null;
    if (forced && TIERS.includes(forced)) return forced;
    return classifyGpu(probeGpu());
}
