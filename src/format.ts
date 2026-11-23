const number = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

export function formatLatLon(lat: number, lon: number, digits = 3): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

/** Coarse elevations are rounded to 10 m and marked approximate. */
export function formatElevation(metres: number): string {
  const rounded = Math.round(metres / 10) * 10;
  if (rounded < 0) return `≈ ${number.format(-rounded)} m below sea level`;
  if (rounded === 0) return '≈ sea level';
  return `≈ ${number.format(rounded)} m`;
}
