/**
 * Locations panel: one-tap teleports to every landmark, grouped by kind in
 * collapsible sections, plus the sky islands. Ported from planet-explorer's
 * 📍 Locations panel (there built with lil-gui); here plain DOM in the HUD's
 * style, so no new dependency.
 *
 * The panel only lists places and calls `go(record)`; main.ts owns what a
 * teleport means (leave the air modes, snap the walker, or hover by an island).
 */
import type { LandmarkRecord } from '../world/landmarks';
import { LANDMARK_COLOR } from '../world/landmarks';

const LABEL: Record<LandmarkRecord['kind'], string> = {
    spire: 'Twisted Spires',
    obelisk: 'Obelisks',
    ring: 'Monolith Rings',
    tombs: 'Tombstone Fields',
    biosphere: 'Floating Biospheres',
    well: 'Ancient Wells',
    arch: 'Ruined Arches',
    ziggurat: 'Ziggurats',
    tower: 'Watchtowers',
    grove: 'Crystal Groves',
    aqueduct: 'Aqueducts',
};

const css = `
#locs { position: fixed; top: 78px; left: 10px; z-index: 19; font: 12px/1.25 var(--font-body);
  color: var(--ink); background: rgba(14, 11, 18, 0.72); border: 1px solid var(--line);
  border-radius: 7px; backdrop-filter: blur(6px); user-select: none; }
#locs[open] { width: 168px; max-height: calc(100dvh - 160px); overflow-y: auto; }
#locs > summary { cursor: pointer; padding: 4px 8px; list-style: none; font-size: 14px; }
#locs > summary::-webkit-details-marker, #locs details > summary::-webkit-details-marker { display: none; }
#locs details details { border-top: 1px solid rgba(232,220,193,0.08); }
#locs details details > summary { cursor: pointer; padding: 4px 8px; display: flex; align-items: center;
  gap: 6px; list-style: none; white-space: nowrap; }
#locs details details > summary::after { content: '▸'; margin-left: auto; opacity: 0.55; font-size: 10px; transition: transform 0.15s; }
#locs details details[open] > summary::after { transform: rotate(90deg); }
#locs .sw { width: 8px; height: 8px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1.5px rgba(0,0,0,0.5); }
#locs .n { opacity: 0.5; font-size: 10px; }
#locs .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 6px 22px; }
#locs button { min-width: 24px; height: 22px; padding: 0 6px; border: 1px solid rgba(232,220,193,0.18);
  border-radius: 5px; background: rgba(255,255,255,0.04); color: var(--ink); font: 600 11px var(--font-body);
  cursor: pointer; }
#locs button:hover, #locs button:focus-visible { background: rgba(223, 112, 56, 0.3); border-color: var(--gold-bright);
  color: #fff; outline: none; }
@media (pointer: coarse) { #locs button { min-width: 34px; height: 34px; } }
`;

export function createLocations(records: LandmarkRecord[], go: (r: LandmarkRecord) => void) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const root = document.createElement('details');
    root.id = 'locs';
    root.innerHTML = '<summary title="Locations" aria-label="Locations">📍</summary>';
    // Group: each ground kind, then sky islands as their own section.
    const groups = new Map<string, { color: number; items: LandmarkRecord[] }>();
    for (const r of records) {
        const key = r.sky ? 'Sky Islands' : LABEL[r.kind];
        if (!groups.has(key)) groups.set(key, { color: LANDMARK_COLOR[r.kind], items: [] });
        groups.get(key)!.items.push(r);
    }
    for (const [name, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const sec = document.createElement('details');
        const hex = '#' + g.color.toString(16).padStart(6, '0');
        sec.innerHTML = `<summary><span class="sw" style="background:${hex}"></span>${name} <span class="n">${g.items.length}</span></summary>`;
        const singular = name.replace(/s$/, '').replace(/ie$/, 'y');
        // Numbered chips in a wrapping row: a group of three is one line, not three.
        const chips = document.createElement('div');
        chips.className = 'chips';
        sec.appendChild(chips);
        g.items.forEach((r, i) => {
            const b = document.createElement('button');
            b.textContent = String(i + 1);
            b.title = `${singular} ${i + 1}`; // full name on hover / for screen readers
            b.setAttribute('aria-label', `Teleport to ${singular} ${i + 1}`);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                go(r);
                b.blur(); // keyboard focus back to the game, so WASD doesn't trigger the button
            });
            chips.appendChild(b);
        });
        root.appendChild(sec);
    }
    // Clicks on the panel must not reach the canvas (which would grab pointer lock).
    for (const ev of ['pointerdown', 'touchstart', 'touchend', 'click'] as const)
        root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    document.body.appendChild(root);

    return {
        el: root,
        toggle() {
            root.style.display = root.style.display === 'none' ? '' : 'none';
        },
        hide() {
            root.style.display = 'none';
        },
        show() {
            root.style.display = '';
        },
    };
}
