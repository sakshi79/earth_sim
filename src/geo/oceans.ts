// Approximate ocean names, used when the place-name service has nothing for open water.

export type OceanName = 'Arctic Ocean' | 'Southern Ocean' | 'Indian Ocean' | 'Atlantic Ocean' | 'Pacific Ocean';

export function oceanName(lat: number, lon: number): OceanName {
  if (lat >= 66) return 'Arctic Ocean';
  if (lat <= -60) return 'Southern Ocean';
  // Indian Ocean: east of Cape Agulhas (20°E), west of the Malay Peninsula, or south of the
  // Indonesian islands as far as Tasmania (147°E).
  if (lat < 30 && ((lon >= 20 && lon <= 100) || (lon > 100 && lon <= 147 && lat < -5))) {
    return 'Indian Ocean';
  }
  // Atlantic: between the Americas and Europe/Africa (Caribbean and Gulf of Mexico included).
  if ((lon >= -100 && lon < 20 && lat > 8) || (lon >= -70 && lon < 20 && lat <= 8)) {
    return 'Atlantic Ocean';
  }
  return 'Pacific Ocean';
}
