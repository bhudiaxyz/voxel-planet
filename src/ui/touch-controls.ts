import nipplejs from 'nipplejs';
import type { FPCamera } from '../render/fp-camera';

/** px → radians per pixel for swipe-look */
const LOOK_SENSITIVITY = 0.004;

// `navigator.maxTouchPoints > 0` is true on most Windows 10/11 laptops regardless of touchscreen.
// `(pointer: coarse)` is the reliable discriminator: phones/tablets use a finger (coarse),
// laptops use a mouse (fine) even when they also have touch hardware.
export const isTouchDevice =
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;

const STYLE = `
#joy-zone {
  position: fixed; left: 0; top: 0;
  width: 50%; height: 100%;
  pointer-events: auto; touch-action: none; z-index: 5;
}
#touch-btns {
  position: fixed;
  right: max(20px, env(safe-area-inset-right));
  bottom: max(100px, calc(80px + env(safe-area-inset-bottom)));
  display: flex; flex-direction: column; flex-wrap: wrap-reverse; gap: 12px;
  max-height: calc(100vh - 140px); align-content: flex-start;
  pointer-events: auto; z-index: 21; /* above the map (20) so 🗺 can close it */
}
@media (max-height: 560px) {
  #touch-btns { bottom: max(16px, env(safe-area-inset-bottom)); max-height: calc(100vh - 32px); gap: 8px; }
  #touch-btns button { width: 46px; height: 46px; font-size: 18px; }
}
#touch-btns button {
  width: 60px; height: 60px; border-radius: 50%;
  border: 1.5px solid rgba(192,88,40,0.55);
  background: rgba(7,7,10,0.55); color: #e8dcc1;
  font-size: 22px; line-height: 1; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none; touch-action: manipulation;
  transition: opacity 0.2s;
}
#touch-btns button:active { background: rgba(192,88,40,0.30); }
#btn-edges.active { border-color: rgba(192,88,40,1); background: rgba(192,88,40,0.25); }
#btn-land, #btn-roll-left, #btn-roll-right { display: none; }
`;

export interface TouchControls {
    /** ✈ — cycle walk → drone → fly (F). */
    onCycle: (fn: () => void) => void;
    /** ☰ — show/hide the HUD panels (G). */
    onPanels: (fn: () => void) => void;
    onLand: (fn: () => void) => void;
    onEdgeToggle: (fn: () => void) => void;
    onTimeBack: (fn: () => void) => void;
    onTimeForward: (fn: () => void) => void;
    onMap: (fn: () => void) => void;
    onDog: (fn: () => void) => void;
    onPause: (fn: () => void) => void;
    /** Call each frame with current mode state to show/hide contextual buttons. */
    update(droneActive: boolean, landing: boolean, flyActive: boolean): void;
    destroy(): void;
}

/**
 * Creates nippleJS left-joystick + right-half swipe-to-look + action buttons.
 *
 * Keyboard ↔ touch mapping:
 *   WASD/arrows  → left joystick
 *   Mouse look   → right-half swipe
 *   Space        → ↑ button  (jump on foot / ascend in drone)
 *   C            → ↓ button  (descend in drone)
 *   Shift        → ⚡ button  (sprint)
 *   F            → ✈ button  (cycle walk → drone → fly, as in planet-explorer)
 *   L            → 🛬 button  (land — visible only while airborne)
 *   Q / E        → ⟲ ⟳ buttons (roll — visible only while airborne)
 *   M            → 🗺️ button  (map)
 *   G            → ☰ button  (toggle panels)
 *   B            → ⬡ button  (block outlines)
 *   [ ]          → ◀ ▶ buttons (time of day)
 *   X            → 🐕 button  (dog sit/stand)
 *   Esc          → ⏸ button  (pause)
 */
export function createTouchControls(fpCam: FPCamera, dom: HTMLElement): TouchControls {
    const stub: TouchControls = {
        onCycle: () => {},
        onPanels: () => {},
        onLand: () => {},
        onEdgeToggle: () => {},
        onTimeBack: () => {},
        onTimeForward: () => {},
        onMap: () => {},
        onDog: () => {},
        onPause: () => {},
        update: () => {},
        destroy: () => {},
    };
    if (!isTouchDevice) return stub;

    fpCam.touchActive = true;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const joyZone = document.createElement('div');
    joyZone.id = 'joy-zone';
    document.body.appendChild(joyZone);

    const btns = document.createElement('div');
    btns.id = 'touch-btns';
    btns.innerHTML = `
    <button id="btn-pause"   aria-label="Pause">⏸</button>
    <button id="btn-map"     aria-label="Map">🗺️</button>
    <button id="btn-jump"    aria-label="Jump / Ascend">↑</button>
    <button id="btn-descend" aria-label="Descend">↓</button>
    <button id="btn-sprint"  aria-label="Sprint">⚡</button>
    <button id="btn-cycle"   aria-label="Cycle walk, drone, fly">🚁</button>
    <button id="btn-land"    aria-label="Land">🛬</button>
    <button id="btn-roll-left"  aria-label="Roll left">⟲</button>
    <button id="btn-roll-right" aria-label="Roll right">⟳</button>
    <button id="btn-panels"  aria-label="Toggle panels">☰</button>
    <button id="btn-edges"   aria-label="Toggle block outlines">⬡</button>
    <button id="btn-time-back"    aria-label="Step time back">◀</button>
    <button id="btn-time-forward" aria-label="Step time forward">▶</button>
    <button id="btn-dog"          aria-label="Dog sit/stand">🐕</button>
  `;
    document.body.appendChild(btns);

    // ---- left joystick (WASD) -----------------------------------------------
    const manager = nipplejs.create({
        zone: joyZone,
        mode: 'dynamic',
        restOpacity: 0.55,
        color: 'rgba(192,88,40,0.8)',
        size: 110,
    });
    manager.on('move', (evt) => {
        const v = evt.data?.vector;
        if (v) fpCam.setTouchMove(v.x, v.y);
    });
    manager.on('end', () => fpCam.setTouchMove(0, 0));

    // ---- right-half swipe-to-look (mouse) -----------------------------------
    let lookId: number | null = null;
    let prevX = 0,
        prevY = 0;

    dom.addEventListener(
        'touchstart',
        (e) => {
            e.preventDefault();
            if (lookId !== null && !Array.from(e.touches).some((t) => t.identifier === lookId)) lookId = null;
            for (const t of Array.from(e.changedTouches)) {
                if (t.clientX >= innerWidth / 2 && lookId === null) {
                    lookId = t.identifier;
                    prevX = t.clientX;
                    prevY = t.clientY;
                }
            }
        },
        { passive: false },
    );

    dom.addEventListener(
        'touchmove',
        (e) => {
            e.preventDefault();
            for (const t of Array.from(e.changedTouches)) {
                if (t.identifier === lookId) {
                    fpCam.applyTouchLook(
                        (t.clientX - prevX) * LOOK_SENSITIVITY,
                        (t.clientY - prevY) * LOOK_SENSITIVITY,
                    );
                    prevX = t.clientX;
                    prevY = t.clientY;
                }
            }
        },
        { passive: false },
    );

    const clearLook = (e: TouchEvent) => {
        for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null;
    };
    dom.addEventListener('touchend', clearLook, { passive: true });
    dom.addEventListener('touchcancel', clearLook, { passive: true });

    // ---- held-state helper --------------------------------------------------
    const held = (id: string, down: () => void, up: () => void) => {
        const el = document.getElementById(id)!;
        el.addEventListener(
            'touchstart',
            (e) => {
                e.stopPropagation();
                down();
            },
            { passive: true },
        );
        el.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                up();
            },
            { passive: true },
        );
        el.addEventListener(
            'touchcancel',
            (e) => {
                e.stopPropagation();
                up();
            },
            { passive: true },
        );
    };

    // ↑ jump / ascend (Space) — ascend in drone or fly, jump on foot
    held(
        'btn-jump',
        () => {
            if (fpCam.droneActive || fpCam.flyActive) fpCam.touchAltAxis = 1;
            else fpCam.triggerTouchJump();
        },
        () => {
            fpCam.touchAltAxis = 0;
        },
    );
    // ↓ descend (C)
    held(
        'btn-descend',
        () => {
            fpCam.touchAltAxis = -1;
        },
        () => {
            fpCam.touchAltAxis = 0;
        },
    );
    // ⚡ sprint (Shift)
    held(
        'btn-sprint',
        () => {
            fpCam.touchSprint = true;
        },
        () => {
            fpCam.touchSprint = false;
        },
    );

    // ⟲ ⟳ roll (Q / E) — drone and fly
    held('btn-roll-left', () => (fpCam.touchRollAxis = -1), () => (fpCam.touchRollAxis = 0));
    held('btn-roll-right', () => (fpCam.touchRollAxis = 1), () => (fpCam.touchRollAxis = 0));

    // ---- tap-only buttons wired externally via returned setters -------------
    const tap = (id: string) => (fn: () => void) =>
        document.getElementById(id)!.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                fn();
            },
            { passive: true },
        );
    const edges = document.getElementById('btn-edges')!;
    const landBtn = document.getElementById('btn-land') as HTMLElement;
    const cycleBtn = document.getElementById('btn-cycle') as HTMLElement;
    const rollL = document.getElementById('btn-roll-left') as HTMLElement;
    const rollR = document.getElementById('btn-roll-right') as HTMLElement;

    const controls: TouchControls = {
        onCycle: tap('btn-cycle'),
        onPanels: tap('btn-panels'),
        onLand: tap('btn-land'),
        onEdgeToggle: (fn) =>
            tap('btn-edges')(() => {
                fn();
                edges.classList.toggle('active');
            }),
        onTimeBack: tap('btn-time-back'),
        onTimeForward: tap('btn-time-forward'),
        onMap: tap('btn-map'),
        onDog: tap('btn-dog'),
        onPause: tap('btn-pause'),
        update(droneActive: boolean, landing: boolean, flyActive: boolean) {
            // Land: shown while airborne in either mode, as in planet-explorer.
            landBtn.style.display = (droneActive && !landing) || flyActive ? 'block' : 'none';
            const roll = droneActive || flyActive ? 'block' : 'none';
            rollL.style.display = roll;
            rollR.style.display = roll;
            // The cycle button shows the mode it switches TO next.
            const next = flyActive ? 'walk' : droneActive ? 'fly' : 'drone';
            cycleBtn.textContent = next === 'walk' ? '🚶' : next === 'fly' ? '✈' : '🚁';
            cycleBtn.setAttribute('aria-label', 'Switch to ' + next);
        },
        destroy() {
            manager.destroy();
            joyZone.remove();
            btns.remove();
            style.remove();
        },
    };
    return controls;
}
