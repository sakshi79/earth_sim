import { describe, expect, it } from 'vitest';
import { guessLandscape, type LandscapeType } from '../src/geo/landscape.ts';

// Real samples from the bundled day image (1024×512) and elevation map at reference places.
const samples: Array<[string, number, [number, number, number], number, LandscapeType]> = [
  ['Sahara', 23, [201, 171, 123], 750, 'desert'],
  ['Erg Chebbi', 31.15, [160, 134, 99], 730, 'desert'],
  ['Deadvlei', -24.76, [159, 113, 68], 630, 'desert'],
  ['Arabia', 22, [191, 155, 117], 330, 'desert'],
  ['Gobi', 43, [121, 104, 74], 1580, 'desert'],
  ['Australian outback', -25, [115, 73, 39], 650, 'desert'],
  ['Everest', 27.988, [176, 175, 170], 5870, 'mountain'],
  ['Everest snowfield (sharper colour map)', 27.988, [232, 234, 236], 5870, 'mountain'],
  ['Patagonian ice field', -49, [235, 238, 240], 1500, 'ice'],
  ['Tibet', 32, [128, 111, 78], 4840, 'mountain'],
  ['Andes', -15, [121, 97, 62], 3990, 'mountain'],
  ['Matterhorn', 45.976, [64, 69, 50], 2070, 'mountain'],
  ['Amazon', -3, [42, 53, 27], 50, 'rainforest'],
  ['Congo', 0, [28, 40, 15], 340, 'rainforest'],
  ['Borneo', 1, [19, 31, 7], 590, 'rainforest'],
  ['Serengeti', -2.45, [95, 74, 48], 1580, 'grassland'],
  ['Great Plains', 40, [92, 84, 53], 730, 'grassland'],
  ['Kazakh steppe', 48, [115, 98, 68], 400, 'grassland'],
  ['Siberian taiga', 60, [28, 40, 16], 330, 'boreal forest'],
  ['Canadian boreal', 55, [23, 33, 9], 200, 'boreal forest'],
  ['Germany', 51, [49, 50, 23], 280, 'temperate forest'],
  ['Appalachia', 37, [32, 46, 14], 780, 'temperate forest'],
  ['Yosemite', 37.746, [45, 41, 23], 1950, 'temperate forest'],
  ['Siberian tundra', 70, [58, 52, 19], 290, 'tundra'],
  ['Nunavut', 65, [144, 144, 132], 150, 'tundra'],
  ['Greenland', 72, [252, 254, 253], 3100, 'ice'],
  ['Antarctica', -80, [242, 242, 242], 3700, 'ice'],
  ['Ilulissat', 69.2, [48, 69, 96], -90, 'coast'],
  ['Pacific', 0, [6, 13, 39], -4180, 'ocean'],
  ['Heron Island', -23.442, [27, 70, 125], -50, 'coast'],
  ['Monterey Bay', 36.62, [51, 69, 76], -50, 'coast'],
];

describe('guessLandscape', () => {
  it.each(samples)('%s', (_name, lat, rgb, elevation, expected) => {
    expect(guessLandscape({ lat, elevation, rgb })).toBe(expected);
  });
});
