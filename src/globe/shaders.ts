import * as THREE from 'three';

/**
 * Drawn over the globe surface (and over zoom tiles): city lights on the night side.
 * Additive, no depth test, so it sits on whatever is below.
 */
export function createNightLightsMaterial(nightMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightMap: { value: nightMap },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      nightIntensity: { value: 1.6 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      uniform float nightIntensity;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        float night = smoothstep(0.05, -0.15, dot(normalize(vWorldNormal), sunDirection));
        gl_FragColor = vec4(texture2D(nightMap, vUv).rgb * night * nightIntensity, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}
