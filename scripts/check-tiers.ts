/**
 * Device → tier table. Renderer strings are what Chrome/Safari actually report
 * (ANGLE format on Windows/Android). Run: npm run check
 */
import assert from 'node:assert/strict';
import { classifyGpu, type GpuProbe, type GpuTier } from '../src/render/gpu-tier.ts';

const desk = (renderer: string, cores = 8, memGB: number | undefined = 8): GpuProbe => ({
    renderer,
    webgl2: true,
    mobile: false,
    cores,
    memGB,
});
const mob = (renderer: string, cores = 8, memGB: number | undefined = 8): GpuProbe => ({
    renderer,
    webgl2: true,
    mobile: true,
    cores,
    memGB,
});

const cases: Array<[string, GpuProbe, GpuTier]> = [
    // desktop / laptop
    [
        'RTX 3060 desktop',
        desk('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 16),
        'high',
    ],
    [
        'GTX 1060 (2016)',
        desk('ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 8),
        'high',
    ],
    ['Radeon RX 580', desk('ANGLE (AMD, Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 6, 16), 'high'],
    [
        'Intel Arc A770',
        desk('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 16),
        'high',
    ],
    [
        'MacBook Air M1 (Chrome)',
        desk('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 8, 8),
        'high',
    ],
    ['MacBook Pro M2 (Safari)', desk('Apple GPU', 8, undefined), 'high'],
    [
        'Intel Arc 140T iGPU (this box)',
        desk(
            'ANGLE (Intel, Intel(R) Arc(TM) Pro 140T GPU (32GB) (0x00007D51) Direct3D11 vs_5_0 ps_5_0, D3D11)',
            16,
            32,
        ),
        'mid',
    ],
    [
        'Iris Xe laptop',
        desk('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 16),
        'mid',
    ],
    [
        'Ryzen 7 780M iGPU',
        desk('ANGLE (AMD, AMD Radeon(TM) Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 16, 16),
        'mid',
    ],
    [
        'Intel UHD 620 (2018 laptop)',
        desk('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8),
        'low',
    ],
    [
        'Intel HD 630 (2017)',
        desk('ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 8),
        'low',
    ],
    [
        'SwiftShader (no GPU)',
        desk('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 8, 8),
        'low',
    ],
    ['Masked renderer, 8 cores', desk('WebKit WebGL', 8, undefined), 'mid'],
    // mobile / tablet
    ['Galaxy S22 Ultra (Snapdragon)', mob('ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)', 8, 8), 'mobile-high'],
    [
        'Galaxy S22 Ultra (Exynos)',
        mob('ANGLE (Samsung Electronics Co., Ltd., Samsung Xclipse 920, OpenGL ES 3.2)', 8, 8),
        'mobile-high',
    ],
    ['iPad (iPadOS Safari)', mob('Apple GPU', 8, undefined), 'mobile-high'],
    ['iPhone XS (2018, 6 cores)', mob('Apple GPU', 6, undefined), 'mobile-high'],
    ['Galaxy S10 (2019, Adreno 640)', mob('ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)', 8, 8), 'mid'],
    // Budget Adreno 61x-62x run low; 630+ (2018-20 flagships) run mid.
    ['Pixel 4a (Adreno 618)', mob('Adreno (TM) 618', 8, 6), 'low'],
    ['Budget Adreno 610', mob('Adreno (TM) 610', 8, 4), 'low'],
    ['Galaxy S9 (2018, Adreno 630)', mob('Adreno (TM) 630', 8, 4), 'mid'],
    // Safari's core count isn't physical: an iPad reporting 4 must not drop to very-low.
    ['iPad reporting 4 cores', mob('Apple GPU', 4, undefined), 'mobile-high'],
    ['Mali-G610 (2022 mid-range)', mob('Mali-G610 MC6', 8, 8), 'mid'],
    ['Galaxy S10 Exynos (Mali-G76)', mob('Mali-G76', 8, 8), 'mid'],
    ['Galaxy A50 (Mali-G72)', mob('Mali-G72', 8, 4), 'very-low'],
    ['Budget Adreno 506', mob('Adreno (TM) 506', 8, 3), 'very-low'],
    ['2 GB phone', mob('Adreno (TM) 640', 8, 2), 'very-low'],
    ['No WebGL2', { renderer: '', webgl2: false, mobile: true, cores: 8, memGB: 4 }, 'very-low'],
    // Older / entry discrete GPUs (2-4 GB) go mid, not high.
    [
        'GTX 1050 Ti laptop',
        desk('ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8),
        'mid',
    ],
    ['GTX 970', desk('ANGLE (NVIDIA, NVIDIA GeForce GTX 970 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 16), 'mid'],
    ['MX450 laptop', desk('ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8), 'mid'],
    ['RX 560', desk('ANGLE (AMD, Radeon RX 560 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8), 'mid'],
    [
        'RTX 3060 stays high',
        desk('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 16),
        'high',
    ],
    [
        'GTX 1070 stays high',
        desk('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 16),
        'high',
    ],
];

for (const [name, probe, want] of cases) assert.equal(classifyGpu(probe), want, name);
console.log(`tiers ok (${cases.length} devices)`);
