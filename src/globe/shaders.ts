import * as THREE from 'three';

/**
 * Drawn over the globe surface (and over zoom tiles): city lights on the night side and a blue
 * haze toward the limb on the day side. Additive, no depth test, so it sits on whatever is below.
 */
export function createSurfaceOverlayMaterial(nightMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightMap: { value: nightMap },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      nightIntensity: { value: 1.6 },
      hazeStrength: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      uniform float nightIntensity;
      uniform float hazeStrength;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        float sunDot = dot(normalize(vWorldNormal), sunDirection);
        float night = smoothstep(0.05, -0.15, sunDot);
        vec3 lights = texture2D(nightMap, vUv).rgb * night * nightIntensity;
        float facing = max(dot(normalize(vViewNormal), normalize(vViewPosition)), 0.0);
        float rim = pow(1.0 - facing, 3.0);
        float day = smoothstep(-0.25, 0.35, sunDot);
        vec3 haze = vec3(0.35, 0.6, 1.0) * rim * day * 0.8 * hazeStrength;
        gl_FragColor = vec4(lights + haze, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

/**
 * Glow around the globe: a back-facing shell whose brightness falls off with the view ray's
 * distance from the globe centre, brighter on the day side. Fades out as the camera gets close.
 */
export function createAtmosphereMaterial(outerRadius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      centerView: { value: new THREE.Vector3() },
      outerRadius: { value: outerRadius },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = mvPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDirection;
      uniform vec3 centerView;
      uniform float outerRadius;
      uniform float opacity;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec3 ray = normalize(vViewPosition);
        float impact = length(cross(centerView, ray)); // distance from globe centre to the view ray
        float glow = 1.0 - smoothstep(1.0, outerRadius, impact);
        glow *= glow;
        float day = smoothstep(-0.4, 0.3, dot(normalize(vWorldNormal), sunDirection));
        vec3 color = vec3(0.3, 0.55, 1.0) * glow * mix(0.1, 1.1, day) * opacity;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
