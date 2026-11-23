import * as THREE from 'three';
import { latLonToVector } from '../geo/sphere.ts';
import type { Place } from '../places.ts';

const MARKER_RADIUS = 1.0015;

/** Dots for the featured places, constant size on screen, hidden behind the globe. */
export function createPlaceMarkers(places: readonly Place[]): THREE.Points {
  const positions = new Float32Array(places.length * 3);
  places.forEach((place, i) => {
    const v = latLonToVector(place.lat, place.lon, MARKER_RADIUS);
    positions.set([v.x, v.y, v.z], i * 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: createDotTexture(),
    color: 0xffd166,
    size: 12,
    sizeAttenuation: false,
    transparent: true,
    alphaTest: 0.4,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 3;
  return points;
}

/** The selected-place pin: a cone standing on the surface. Scale it with camera altitude. */
export function createPin(): THREE.Group {
  const pin = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xff5a5f });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1, 20), material);
  cone.rotation.x = Math.PI; // tip down
  cone.position.y = 0.5; // tip on the surface
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12), material);
  head.position.y = 1.05;
  pin.add(cone, head);
  pin.renderOrder = 3;
  pin.visible = false;
  return pin;
}

/** Places the pin at a point and stands it up along the surface normal. */
export function placePin(pin: THREE.Group, lat: number, lon: number): void {
  const v = latLonToVector(lat, lon, 1);
  pin.position.set(v.x, v.y, v.z);
  pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pin.position.clone().normalize());
  pin.visible = true;
}

function createDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
