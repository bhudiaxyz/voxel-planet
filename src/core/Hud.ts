import GUI from "lil-gui";
import type { Environment } from "../planet/Environment";
import type { TerrainNoise } from "../planet/TerrainNoise";
import { WEATHER_OPTIONS } from "../planet/Environment";
import { generateRandomSeed } from "../utils/Random";

function timeLabel(tod: number): string {
  if (tod < 0.1 || tod >= 0.95) return "Night";
  if (tod < 0.28) return "Dawn";
  if (tod < 0.45) return "Morning";
  if (tod < 0.55) return "Noon";
  if (tod < 0.75) return "Afternoon";
  if (tod < 0.85) return "Dusk";
  return "Night";
}

export class Hud {
  private elFps: HTMLElement;
  private elSeed: HTMLElement;
  private elStatus: HTMLElement;
  private elInteract: HTMLElement;
  private gui: GUI | null = null;

  private elHint: HTMLElement | null = null;

  constructor(seed: number) {
    const get = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`HUD element #${id} not found`);
      return el;
    };

    this.elFps = get("hud-fps");
    this.elSeed = get("hud-seed");
    this.elStatus = get("hud-status");
    this.elInteract = get("hud-interact");
    this.elHint = document.getElementById("click-hint");

    this.elSeed.textContent = `Seed: ${seed}`;
    this.elInteract.style.display = "none";

    const btn = document.createElement('button');
    btn.id = 'new-world-btn';
    btn.textContent = 'New World';
    btn.addEventListener('click', () => {
      const s = generateRandomSeed();
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(s));
      window.location.href = url.toString();
    });
    document.getElementById('hud')?.appendChild(btn);
  }

  update(
    fps: number,
    timeOfDay: number,
    weatherKey: string,
    underwater: boolean,
    drone: boolean,
  ): void {
    this.elFps.textContent = `FPS: ${Math.round(fps)}`;
    const tl = timeLabel(timeOfDay);
    const weather = weatherKey.charAt(0).toUpperCase() + weatherKey.slice(1);
    this.elStatus.textContent = underwater
      ? `${tl} · ${weather} · Underwater`
      : `${tl} · ${weather}`;
    if (this.elHint && !this.elHint.classList.contains("hidden")) {
      this.elHint.innerHTML = drone
        ? "Drone &nbsp;·&nbsp; A/D strafe &nbsp;·&nbsp; Space/Z altitude &nbsp;·&nbsp; G exit &nbsp;·&nbsp; Tab weather &nbsp;·&nbsp; T time"
        : "WASD move &nbsp;·&nbsp; F fly &nbsp;·&nbsp; G drone &nbsp;·&nbsp; Shift sprint &nbsp;·&nbsp; Tab weather &nbsp;·&nbsp; T time";
    }
  }

  showInteract(text: string | null): void {
    if (text) {
      this.elInteract.textContent = text;
      this.elInteract.style.display = "block";
    } else {
      this.elInteract.style.display = "none";
    }
  }

  buildSettingsPanel(
    env: Environment,
    noise: TerrainNoise,
    onTerrainChange: () => void,
  ): void {
    if (this.gui) this.gui.destroy();
    this.gui = new GUI({ title: "Settings", width: 280 });
    this.gui.close();

    // Planet / terrain folder
    const planet = this.gui.addFolder("Planet");
    const noiseProxy = noise.params as unknown as Record<string, unknown>;
    planet
      .add(noiseProxy, "type", ["simplex", "fractal", "ridged"])
      .name("Noise type")
      .onChange(onTerrainChange);
    planet
      .add(noiseProxy, "amplitude", 100, 4000, 50)
      .name("Amplitude (m)")
      .onChange(onTerrainChange);
    planet
      .add(noiseProxy, "period", 500, 20000, 100)
      .name("Period (m)")
      .onChange(onTerrainChange);
    planet
      .add(noiseProxy, "octaves", 1, 8, 1)
      .name("Octaves")
      .onChange(onTerrainChange);

    // Environment folder
    const envFolder = this.gui.addFolder("Environment");
    const envProxy = {
      timeOfDay: env.timeOfDay,
      weather: env.weatherKey,
      daySpeed: 1.0,
      windStrength: 1.0,
      windDirection: 0,
    };
    envFolder
      .add(envProxy, "timeOfDay", 0, 1, 0.01)
      .name("Time of day")
      .onChange((v: number) => {
        env.setTimeOfDay(v);
      });
    envFolder
      .add(envProxy, "weather", WEATHER_OPTIONS)
      .name("Weather")
      .onChange((v: string) => {
        env.setWeather(v);
      });
    envFolder
      .add(envProxy, "daySpeed", 0, 10, 0.1)
      .name("Day speed")
      .onChange((v: number) => {
        env.setDaySpeed(v);
      });
    envFolder
      .add(envProxy, "windStrength", 0, 3, 0.05)
      .name("Wind strength")
      .onChange((v: number) => {
        env.setWindStrength(v);
      });
    envFolder
      .add(envProxy, "windDirection", 0, 360, 1)
      .name("Wind direction °")
      .onChange((v: number) => {
        env.setWindDirection(v * Math.PI / 180);
      });

    // Rendering folder
    const renderFolder = this.gui.addFolder("Rendering");
    const renderProxy = { quality: "auto" };
    renderFolder
      .add(renderProxy, "quality", ["auto", "high", "medium", "low"])
      .name("Quality preset")
      .onChange(() => {
        // Quality changes require a full reload
        const url = new URL(window.location.href);
        url.searchParams.set("quality", renderProxy.quality);
        window.location.href = url.toString();
      });

    // Vegetation folder
    const vegFolder = this.gui.addFolder("Vegetation");
    const vegProxy = { treeDensity: 1.0, grassDensity: 1.0 };
    vegFolder.add(vegProxy, "treeDensity", 0, 2, 0.1).name("Tree density");
    vegFolder.add(vegProxy, "grassDensity", 0, 2, 0.1).name("Grass density");
  }

  hideLoading(): void {
    const loading = document.getElementById("loading");
    if (!loading) return;
    loading.style.transition = "opacity 0.6s ease";
    loading.style.opacity = "0";
    setTimeout(() => loading.remove(), 650);
  }
}
