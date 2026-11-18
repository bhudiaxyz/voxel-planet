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

/* Same card language as the pause and settings panels: --panel glass, hairline
 * rim, display-font title over a rule, uppercase section labels, menu-button rows. */
const css = `
#locs { position: fixed; top: 78px; left: max(14px, env(safe-area-inset-left)); z-index: 19;
  font: 500 12px/1.25 var(--font-body); color: var(--ink);
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  backdrop-filter: blur(18px) saturate(1.12); box-shadow: var(--shadow); user-select: none; }
#locs[open] { width: 248px; max-height: calc(100dvh - 160px); overflow-y: auto; padding: 0 0 8px; }
/* Closed: a 38px square button, like the HUD's settings button. */
#locs > summary { cursor: pointer; list-style: none; width: 38px; height: 38px;
  display: grid; place-items: center; font-size: 17px; color: var(--ink-soft); }
#locs > summary:hover { color: var(--accent); }
#locs[open] > summary { width: auto; height: auto; display: flex; align-items: center; gap: 8px;
  margin: 0 14px 6px; padding: 14px 0 12px; border-bottom: 1px solid var(--line);
  font: 600 20px/1 var(--font-display); letter-spacing: -.01em; color: var(--cream); }
#locs[open] > summary::after { content: 'Locations'; }
#locs[open] > summary::before { content: '×'; order: 2; margin-left: auto; font: 400 19px/1 var(--font-body);
  color: var(--ink-faint); }
#locs[open] > summary:hover::before { color: var(--accent); }
#locs > summary::-webkit-details-marker, #locs details > summary::-webkit-details-marker { display: none; }
/* Group rows: uppercase labels with a colour swatch and a count, chevron on the right. */
#locs > details > summary { cursor: pointer; margin: 0 8px; padding: 8px 6px; display: flex;
  align-items: center; gap: 8px; list-style: none; white-space: nowrap; border-radius: var(--radius-sm);
  font-size: 10px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
#locs > details > summary:hover { background: var(--tint); color: var(--ink); }
#locs > details > summary::after { content: '▸'; margin-left: auto; color: var(--ink-faint);
  font-size: 10px; transition: transform 0.15s; }
#locs > details[open] > summary::after { transform: rotate(90deg); color: var(--accent); }
#locs > details[open] > summary { color: var(--accent-bright); }
#locs .sw { width: 7px; height: 7px; border-radius: 50%; flex: none; box-shadow: 0 0 0 1px rgba(236,230,216,0.4); }
#locs .n { min-width: 18px; height: 16px; padding: 0 4px; display: inline-grid; place-items: center;
  border-radius: var(--radius-sm); background: var(--tint); color: var(--accent);
  font-size: 9px; font-weight: 700; letter-spacing: 0; }
/* Places: compact rows like the pause menu's buttons. */
#locs .chips { display: flex; flex-direction: column; gap: 2px; padding: 2px 14px 8px 29px; }
#locs button { height: 28px; padding: 0 9px; text-align: left; border: 1px solid transparent;
  border-radius: var(--radius-sm); background: none; color: var(--ink-soft); font: 500 12px var(--font-body);
  cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background .14s ease, border-color .14s ease; }
#locs button:hover, #locs button:focus-visible { background: var(--panel-hover); border-color: var(--accent);
  color: var(--ink); outline: none; }
@media (pointer: coarse) { #locs button { height: 36px; } }
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
        // Compact 22px rows of named places under each group.
        const chips = document.createElement('div');
        chips.className = 'chips';
        sec.appendChild(chips);
        g.items.forEach((r, i) => {
            const b = document.createElement('button');
            // One compact row per place, showing its name (long names clip with an ellipsis).
            b.textContent = r.name;
            b.title = `${r.name} — ${singular}`;
            b.setAttribute('aria-label', `Teleport to ${r.name}`);
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
