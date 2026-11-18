/** Player pause menu — Escape. Shows adaptive key/touch bindings. */

import { isTouchDevice } from './touch-controls';

const CSS = `
#pause {
  position:fixed; inset:0; z-index:45; display:none;
  align-items:center; justify-content:center;
  background:rgba(5,11,22,.55); backdrop-filter:blur(10px) saturate(1.04);
  font-family:var(--font-body); color:var(--ink);
}
#pause.open { display:flex; }
#pause .panel {
  width:min(360px, calc(100vw - 32px)); padding:18px 20px 20px;
  border-radius:var(--radius); background:var(--panel);
  border:1px solid var(--line);
  backdrop-filter:blur(18px) saturate(1.12);
  box-shadow:var(--shadow);
}
#pause h2 { margin:0 0 18px; padding-bottom:12px; border-bottom:1px solid var(--line); font:600 20px/1 var(--font-display); letter-spacing:-.01em; color:var(--accent); }
#pause nav { display:grid; gap:8px; }
#pause button {
  width:100%; height:42px; padding:0 14px; display:flex; align-items:center;
  justify-content:space-between; border:1px solid var(--line);
  border-radius:var(--radius-sm); background:var(--panel-raised); color:var(--ink-soft);
  font:600 11px/1 var(--font-body);
  letter-spacing:.14em; text-transform:uppercase; cursor:pointer;
  transition:background .14s ease, border-color .14s ease;
}
#pause button:hover, #pause button:focus-visible {
  outline:none; background:var(--panel-hover); border-color:var(--accent);
}
#pause #pause-resume { background:var(--tint); border-color:var(--line-strong); color:var(--accent-bright); }
#pause #pause-resume:hover, #pause #pause-resume:focus-visible {
  background:var(--tint-strong); border-color:var(--accent);
}
#pause kbd {
  min-width:22px; height:20px; padding:0 5px; display:inline-grid; place-items:center;
  border-radius:5px; background:var(--tint); color:var(--accent);
  font:700 9px/1 var(--font-body);
  text-transform:uppercase; white-space:nowrap;
}
#pause .controls {
  margin-top:18px; padding-top:16px;
  border-top:1px solid var(--tint);
}
#pause .controls h3 {
  margin:0 0 10px; font-size:10px; font-weight:600;
  letter-spacing:.16em; text-transform:uppercase; color:var(--ink-faint);
}
#pause .bindings {
  display:grid; grid-template-columns:1fr 1fr; gap:5px 10px;
}
#pause .binding {
  display:flex; align-items:center; gap:6px;
  font-size:11px; color:var(--ink-soft);
  letter-spacing:.02em;
}
#pause .binding kbd { flex-shrink:0; }
`;

// Mirrors planet-explorer; voxel-planet extras use keys it leaves free.
const KEYBOARD_BINDINGS = [
    ['WASD', 'Move'],
    ['Mouse', 'Look'],
    ['Shift', 'Sprint'],
    ['Space', 'Jump / Ascend'],
    ['C', 'Descend'],
    ['F', 'Cycle walk → drone → fly'],
    ['L', 'Land'],
    ['Q / E', 'Roll (drone / fly)'],
    ['M', 'Map'],
    ['G', 'Toggle panels'],
    ['X', 'Dog sit / stand'],
    ['B', 'Block outlines'],
    ['[ ]', 'Time of day'],
    ['Esc', 'Pause / release mouse'],
];

const TOUCH_BINDINGS = [
    ['Left stick', 'Move'],
    ['Right drag', 'Look'],
    ['↑', 'Jump / Ascend'],
    ['↓', 'Descend'],
    ['⚡', 'Sprint'],
    ['✈', 'Cycle walk → drone → fly'],
    ['🛬', 'Land'],
    ['⟲ ⟳', 'Roll (drone / fly)'],
    ['🗺️', 'Map'],
    ['☰', 'Toggle panels'],
    ['🐕', 'Dog sit / stand'],
    ['⬡', 'Block outlines'],
    ['◀ ▶', 'Time of day'],
    ['⏸', 'Pause'],
    ['⚙', 'Settings'],
];

function buildBindings(rows: string[][]): string {
    return rows.map(([key, label]) => `<div class="binding"><kbd>${key}</kbd><span>${label}</span></div>`).join('');
}

export function createPause({ input, map }: { input: { paused: boolean }; map: { toggle(): void } }) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const bindings = isTouchDevice ? TOUCH_BINDINGS : KEYBOARD_BINDINGS;

    const root = document.createElement('div');
    root.id = 'pause';
    root.innerHTML = `
    <div class="panel" role="dialog" aria-label="Pause menu" aria-modal="true">
      <h2>Paused</h2>
      <nav>
        <button type="button" id="pause-resume"><span>Resume</span><kbd>Esc</kbd></button>
        <button type="button" id="pause-map"><span>Map</span><kbd>M</kbd></button>
      </nav>
      <div class="controls">
        <h3>Controls</h3>
        <div class="bindings">${buildBindings(bindings)}</div>
      </div>
    </div>
  `;
    document.body.appendChild(root);

    const resume = root.querySelector('#pause-resume');
    let open = false;
    let wasPaused = false;

    const setOpen = (next: any) => {
        if (next === open) return;
        open = next;
        root.classList.toggle('open', open);
        if (open) {
            wasPaused = input.paused;
            input.paused = true;
            (resume as any).focus({ preventScroll: true });
        } else {
            input.paused = wasPaused;
        }
    };

    resume!.addEventListener('click', () => setOpen(false));
    root.querySelector('#pause-map')!.addEventListener('click', () => {
        setOpen(false);
        map.toggle();
    });
    root.addEventListener('click', (e) => {
        if (e.target === root) setOpen(false);
    });

    addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.code === 'Escape') {
            e.preventDefault();
            setOpen(!open);
        } else if (e.code === 'KeyM' && open) {
            e.preventDefault();
            setOpen(false);
            map.toggle();
        }
    });

    return {
        el: root,
        get open() {
            return open;
        },
        toggle: () => setOpen(!open),
    };
}
