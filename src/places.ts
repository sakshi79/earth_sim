// Featured places (docs/SPEC.md section 7). Coordinates checked on 2026-11-22 against
// Terrain Tiles elevation and OpenStreetMap place names.

export type PlaceGroup = 'Desert' | 'Mountain' | 'Valley' | 'Ocean' | 'Forest and savanna' | 'Polar';

export interface Place {
  id: string;
  name: string;
  region: string;
  group: PlaceGroup;
  lat: number;
  lon: number;
}

export const featuredPlaces: readonly Place[] = [
  { id: 'erg-chebbi', name: 'Erg Chebbi dunes', region: 'Morocco', group: 'Desert', lat: 31.15, lon: -3.97 },
  { id: 'deadvlei', name: 'Deadvlei', region: 'Namibia', group: 'Desert', lat: -24.76, lon: 15.29 },
  { id: 'everest', name: 'Mount Everest', region: 'Nepal and China', group: 'Mountain', lat: 27.988, lon: 86.925 },
  { id: 'matterhorn', name: 'Matterhorn', region: 'Switzerland and Italy', group: 'Mountain', lat: 45.976, lon: 7.659 },
  { id: 'kilauea', name: 'Kīlauea', region: 'Hawaiʻi, USA', group: 'Mountain', lat: 19.41, lon: -155.28 },
  { id: 'yosemite', name: 'Yosemite Valley', region: 'California, USA', group: 'Valley', lat: 37.746, lon: -119.594 },
  { id: 'grand-canyon', name: 'Grand Canyon', region: 'Arizona, USA', group: 'Valley', lat: 36.062, lon: -112.108 },
  { id: 'heron-island', name: 'Heron Island reef', region: 'Great Barrier Reef, Australia', group: 'Ocean', lat: -23.442, lon: 151.915 },
  { id: 'monterey', name: 'Monterey Bay kelp forest', region: 'California, USA', group: 'Ocean', lat: 36.62, lon: -121.9 },
  { id: 'reserva-ducke', name: 'Reserva Ducke', region: 'Amazon, Brazil', group: 'Forest and savanna', lat: -2.93, lon: -59.97 },
  { id: 'serengeti', name: 'Serengeti', region: 'Tanzania', group: 'Forest and savanna', lat: -2.45, lon: 34.83 },
  { id: 'ilulissat', name: 'Ilulissat Icefjord', region: 'Greenland', group: 'Polar', lat: 69.2, lon: -51.0 },
];
