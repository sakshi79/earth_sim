import * as THREE from 'three';
import type { OverpassPOI } from '../data/overpass.ts';
import type { TerrainWindow } from './terrainWindow.ts';
import { latLonToLocal } from './terrainWindow.ts';

const ICON: Record<string, string> = {
  peak: '▲',
  volcano: '🌋',
  viewpoint: '👁',
  waterfall: '💧',
  cave_entrance: '◉',
  place_of_worship: '⛪',
  attraction: '★',
  museum: '🏛',
  village: '●',
  town: '●',
  city: '●',
  hamlet: '·',
  suburb: '·',
};

/** Floating name labels for notable landmarks. */
export class POILabels {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];

  constructor(pois: OverpassPOI[], w: TerrainWindow, heightAt: (x: number, z: number) => number) {
    const seen = new Set<string>();
    for (const poi of pois) {
      const key = `${poi.name}@${poi.lat.toFixed(4)},${poi.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const { x, z } = latLonToLocal(w, poi.lat, poi.lon);
      const y = heightAt(x, z) + labelHeight(poi.category);
      const icon = ICON[poi.category] ?? '•';
      const sprite = createLabel(`${icon} ${poi.name}`, poi.category);
      sprite.position.set(x, y, z);
      this.group.add(sprite);
      this.sprites.push(sprite);
    }
  }

  update(cameraPosition: THREE.Vector3): void {
    for (const sprite of this.sprites) {
      const dist = sprite.position.distanceTo(cameraPosition);
      sprite.visible = dist < 3000;
      if (sprite.visible) {
        const scale = THREE.MathUtils.clamp(dist * 0.07, 8, 200);
        sprite.scale.set(scale * 4, scale, 1);
      }
    }
  }

  dispose(): void {
    for (const sprite of this.sprites) {
      (sprite.material as THREE.SpriteMaterial).map?.dispose();
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}

function labelHeight(category: string): number {
  if (category === 'peak' || category === 'volcano') return 25;
  if (category === 'town' || category === 'city') return 30;
  return 15;
}

function createLabel(text: string, category: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const size = 512;
  canvas.width = size * 4;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.font = `bold ${size * 0.32}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const isPlace = ['village', 'town', 'city', 'hamlet', 'suburb', 'neighbourhood', 'locality'].includes(category);
  const fill = isPlace ? 'rgba(255,255,255,0.95)' : 'rgba(255,248,220,0.95)';
  const stroke = 'rgba(0,0,0,0.7)';

  ctx.strokeStyle = stroke;
  ctx.lineWidth = size * 0.06;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = fill;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  return sprite;
}
