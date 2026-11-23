// Coarse landscape guess for the globe preview, from latitude, the bundled elevation map and the
// colour of the NASA day image. Thresholds were calibrated on sampled reference places
// (see tests/landscape.test.ts). The full classifier with local tiles comes in M4.

export type LandscapeType =
  | 'ocean'
  | 'coast'
  | 'ice'
  | 'mountain'
  | 'desert'
  | 'tundra'
  | 'rainforest'
  | 'boreal forest'
  | 'temperate forest'
  | 'grassland';

export interface LandscapeInput {
  lat: number;
  /** Coarse elevation in metres (negative below sea level). */
  elevation: number;
  /** Colour of the day image at that point, 0–255. */
  rgb: readonly [number, number, number];
}

export const landscapeLabels: Record<LandscapeType, string> = {
  ocean: 'Open ocean',
  coast: 'Coast and shallow sea',
  ice: 'Ice sheet',
  mountain: 'Mountains',
  desert: 'Desert',
  tundra: 'Tundra',
  rainforest: 'Tropical rainforest',
  'boreal forest': 'Boreal forest',
  'temperate forest': 'Temperate forest',
  grassland: 'Grassland and savanna',
};

export function guessLandscape({ lat, elevation, rgb }: LandscapeInput): LandscapeType {
  const [r, g, b] = rgb;
  const brightness = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  const greenness = g + r === 0 ? 0 : (g - r) / (g + r);
  const absLat = Math.abs(lat);

  const looksLikeWater = b > r + 15 && b >= g;
  if (elevation < -500 || looksLikeWater) return elevation < -200 ? 'ocean' : 'coast';
  // Snow-white is an ice sheet at high latitude or low elevation; elsewhere it is a snowy peak.
  if (brightness > 200 && saturation < 0.12 && (absLat >= 60 || elevation <= 2000)) return 'ice';
  if (elevation > 2000) return 'mountain';
  if ((greenness < -0.06 && brightness > 95) || greenness < -0.18) return 'desert';
  if (absLat >= 60 && greenness < 0.1) return 'tundra';
  if (brightness < 50 && greenness > -0.07) {
    if (absLat < 23.5) return 'rainforest';
    return absLat >= 55 ? 'boreal forest' : 'temperate forest';
  }
  return 'grassland';
}
