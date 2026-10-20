import defaults from "./settings/defaults.json";

export type QualityLevel = "low" | "medium" | "high";

export interface QualitySettings {
  maxPixelRatio: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  viewRadius: number;
  detailRadius: number;
  midRadius: number;
}

export const QUALITY_PRESETS = defaults.quality.presets as Record<QualityLevel, QualitySettings>;
export const FORCED_QUALITY  = defaults.quality.forcedLevel as QualityLevel | null;
export const PLANET     = defaults.planet;
export const PLAYER     = defaults.player;
export const CAMERA     = defaults.camera;
export const RENDERER   = defaults.renderer;
export const ATMOSPHERE = defaults.atmosphere;
export const SKY        = defaults.sky;
export const WEATHER    = defaults.weather;
export const BIOMES     = defaults.biomes;
export const WIND       = defaults.wind;
export const VEGETATION = defaults.vegetation;
export const STREAMING  = defaults.streaming;
export const OCEAN      = defaults.ocean;
export const HORIZON    = defaults.horizon;
