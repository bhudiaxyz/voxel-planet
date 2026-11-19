/**
 * HUD — minimal in-game overlay: place title, clock, drone altitude, shortcut hints, gear button.
 *
 * Purpose
 *   Gameplay owns the screen. The only persistent chrome is a time-of-day chip, a small set of
 *   key hints (X sit, M map, Esc menu) and the settings gear; everything else is transient.
 *
 * Operations
 *   - Injects its own <style> and a fixed #hud root (pointer-events none except the gear button),
 *     themed by the CSS variables (--panel, --line, --accent ...) defined in index.html.
 *   - The title ("VoxelWorld") shows at start and hides after 3.2 s; announce(name) re-shows it
 *     for 2.6 s (used for teleports to named places). Key hints fade in after 0.9 s and are
 *     hidden on narrow or coarse-pointer screens (touch has its own buttons).
 *   - update(), called every frame: formats dayNight.timeOfDay (0..1 of a day) as HH:MM with a
 *     sun or moon icon (sun from 06:00 to 20:00), and shows "up N m" only while the drone is
 *     active.
 *   - toggle() hides or shows the whole HUD (G / the touch panels button).
 *
 * Usage
 *   Created by src/main.ts: createHud({ dayNight, drone }). main calls hud.update() each frame,
 *   hud.showSettingsBtn() once the world is ready, hud.onSettingsClick(cb) to open settings,
 *   hud.announce(name) and hud.toggle().
 *
 * See also: settings.ts, pause.ts, locations.ts; DESIGN.md "16. Controls, UI and map".
 */

import type { DayNight } from '../render/day-night';

const CSS = `
#hud {
  position:fixed; inset:0; z-index:20; pointer-events:none;
  font-family:var(--font-body);
  color:var(--ink);
  --hud-shadow:0 8px 24px rgba(0,0,0,.4);
}
#hud .place {
  position:absolute; left:50%; top:max(24px, env(safe-area-inset-top));
  transform:translate(-50%, -6px); opacity:0;
  font:300 18px/1 var(--font-display); letter-spacing:.16em; text-transform:uppercase;
  color:var(--cream);
  text-shadow:0 2px 14px rgba(0,0,0,.6);
  transition:opacity .55s ease, transform .55s ease;
}
#hud .place.show { opacity:.9; transform:translate(-50%, 0); }
#hud .shortcuts {
  position:absolute; right:max(18px, env(safe-area-inset-right));
  bottom:max(18px, env(safe-area-inset-bottom));
  display:flex; gap:7px; opacity:0; transform:translateY(5px);
  transition:opacity .45s ease, transform .45s ease;
}
#hud .shortcuts.show { opacity:.82; transform:none; }
#hud .shortcut {
  display:flex; align-items:center; gap:7px; height:30px; padding:0 10px 0 7px;
  border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--panel); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); font-size:10px; font-weight:600;
  letter-spacing:.12em; text-transform:uppercase; color:var(--ink-soft);
}
#hud kbd {
  min-width:18px; height:18px; padding:0 4px; display:grid; place-items:center;
  border-radius:var(--radius-sm); background:var(--tint); color:var(--accent);
  font:700 10px/1 var(--font-body);
  box-shadow:none; border:1px solid var(--line);
}
#hud .status-bar {
  position:absolute; left:max(18px, env(safe-area-inset-left));
  bottom:max(18px, env(safe-area-inset-bottom));
  display:flex; flex-direction:column; gap:6px; align-items:flex-start;
}
#hud .status-chip {
  display:flex; align-items:center; gap:6px; height:28px; padding:0 10px 0 8px;
  border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--panel); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); font-size:11px; font-weight:600;
  letter-spacing:.08em; font-variant-numeric:tabular-nums; opacity:.82;
  color:var(--ink-soft);
}
#hud .settings-btn {
  position:absolute; top:max(14px, env(safe-area-inset-top));
  right:max(14px, env(safe-area-inset-right));
  pointer-events:none; width:38px; height:38px;
  opacity:0; transition:opacity .4s ease, background .14s ease, border-color .14s ease, color .14s ease;
  border:1px solid var(--line); border-radius:var(--radius-sm);
  background:var(--panel); backdrop-filter:blur(14px) saturate(1.08);
  box-shadow:var(--hud-shadow); color:var(--ink-soft);
  font-size:18px; cursor:pointer; display:grid; place-items:center;
  -webkit-tap-highlight-color:transparent;
}
#hud .settings-btn.visible { opacity:.82; pointer-events:auto; }
#hud .settings-btn:hover, #hud .settings-btn:focus-visible {
  outline:none; background:var(--panel-hover); border-color:var(--accent); color:var(--accent);
}
@media (max-width:640px), (pointer:coarse) {
  #hud .shortcuts { display:none; }
}
`;

interface HudDeps {
    dayNight: DayNight;
    drone: { active: boolean; altitude: number };
}

export function createHud({ dayNight, drone }: HudDeps) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
    <div class="place show" id="hud-place">VoxelWorld</div>
    <button class="settings-btn" id="hud-settings" type="button" aria-label="Settings">⚙</button>
    <div class="shortcuts" id="hud-shortcuts">
      <span class="shortcut"><kbd>X</kbd>Sit</span>
      <span class="shortcut"><kbd>M</kbd>Map</span>
      <span class="shortcut"><kbd>Esc</kbd>Menu</span>
    </div>
    <div class="status-bar">
      <div class="status-chip" id="hud-time">🕐 --:--</div>
      <div class="status-chip" id="hud-drone" style="display:none">↑ -- m</div>
    </div>
  `;
    document.body.appendChild(root);

    const place = root.querySelector('#hud-place') as HTMLElement;
    const shortcuts = root.querySelector('#hud-shortcuts') as HTMLElement;
    const settingsBtn = root.querySelector('#hud-settings') as HTMLButtonElement;
    const timeEl = root.querySelector('#hud-time') as HTMLElement;
    const droneEl = root.querySelector('#hud-drone') as HTMLElement;

    setTimeout(() => place.classList.remove('show'), 3200);
    setTimeout(() => shortcuts.classList.add('show'), 900);

    return {
        onSettingsClick(cb: () => void) {
            settingsBtn.addEventListener('click', cb);
        },
        /** G / ☰ — hide or show every HUD panel (toggle panels, as in planet-explorer). */
        toggle() {
            root.style.display = root.style.display === 'none' ? '' : 'none';
        },
        showSettingsBtn() {
            settingsBtn.classList.add('visible');
        },
        update() {
            // Time of day — always visible
            const tod = dayNight.timeOfDay;
            const totalH = tod * 24;
            const hour = Math.floor(totalH);
            const min = Math.floor((totalH - hour) * 60);
            const icon = hour >= 6 && hour < 20 ? '☀' : '🌙';
            timeEl.textContent = `${icon} ${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

            // Drone stats — only when active
            if (drone.active) {
                droneEl.style.display = 'flex';
                const alt = Math.round(drone.altitude);
                droneEl.textContent = `↑ ${alt} m`;
            } else {
                droneEl.style.display = 'none';
            }
        },
        announce(name: string) {
            place.textContent = name;
            place.classList.add('show');
            clearTimeout((place as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t);
            (place as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
                () => place.classList.remove('show'),
                2600,
            );
        },
    };
}
