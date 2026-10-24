import { Color, Material, ShaderChunk, Vector4 } from 'three';

/**
 * Mist that hugs the ground.
 *
 * three's fog is a function of distance alone, so the far end of a scene is
 * veiled exactly as much at rooftop height as at the ground, and the only way to
 * thin the haze over a district is to thin it everywhere. This patches the fog
 * chunks every built-in material shares to take a second term: the linear fog's
 * optical depth is scaled by how much of the view ray runs through an exponential
 * layer standing on `base`, with scale height `scale`. Streets and lawns far away
 * sink into mist while rooftops, trees and the sky above stay clear, which is how
 * low-lying fog actually looks from altitude.
 *
 * `fogHeight` is shared by every material; the engine writes it each frame from the
 * chapter grade. x = 0 (the default) leaves fog exactly as three draws it.
 *   x strength 0..1   y base height   z scale height   w ground density boost
 */
export const fogHeight = { value: new Vector4(0, 0, 8, 1) };

/**
 * Sunlight in the haze. Real air is not one flat colour: looking toward a low sun it glows with the
 * sun's colour (the forward scattering of every droplet and dust grain along the view), looking
 * away it keeps the sky's. The fog colour is lifted toward `fogSunColor` by how close the view ray
 * runs to the sun, a broad glow and a tighter core around it (what Unreal's height fog calls
 * directional inscattering). xyz is the direction toward the sun, w the strength; 0 is off.
 */
export const fogSun = { value: new Vector4(0, 1, 0, 0) };
export const fogSunColor = { value: new Color() };

ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogWorldY;
	varying vec3 vFogDir;
#endif
`;

ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// world height of this vertex, recovered from the view-space position
	vFogWorldY = cameraPosition.y + dot( viewMatrix[ 1 ].xyz, mvPosition.xyz );
	// the view ray in world space (the view rotation is orthonormal: its transpose turns it back)
	vFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogWorldY;
	varying vec3 vFogDir;
	uniform vec4 uFogHeight;
	uniform vec4 uFogSun;
	uniform vec3 uFogSunColor;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;

ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	if ( uFogHeight.x > 0.0 && fogFactor > 0.0 ) {
		// the linear fog as an optical depth, thinned by the layer along the view ray
		float tau = - log( max( 1.0 - fogFactor, 1e-4 ) );
		float k = 1.0 / max( uFogHeight.z, 0.1 );
		float h0 = max( cameraPosition.y - uFogHeight.y, 0.0 );
		float h1 = max( vFogWorldY - uFogHeight.y, 0.0 );
		float e0 = exp( - k * h0 );
		float e1 = exp( - k * h1 );
		float dh = k * ( h1 - h0 );
		float along = abs( dh ) < 1e-3 ? e0 : clamp( ( e0 - e1 ) / dh, 0.0, 1.0 );
		fogFactor = 1.0 - exp( - tau * mix( 1.0, along * uFogHeight.w, uFogHeight.x ) );
	}
	vec3 fogTint = fogColor;
	float fogRay = length( vFogDir );
	if ( uFogSun.w > 0.0 && fogRay > 1e-4 ) {
		float mu = max( dot( vFogDir / fogRay, uFogSun.xyz ), 0.0 );
		fogTint += uFogSunColor * uFogSun.w * ( 0.45 * pow( mu, 6.0 ) + 1.1 * pow( mu, 40.0 ) );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`;

// every built-in material gets the shared uniform; ones with their own hook keep it (and fog as before)
const base = Material.prototype.onBeforeCompile;
Material.prototype.onBeforeCompile = function (shader, renderer): void {
  shader.uniforms.uFogHeight = fogHeight;
  shader.uniforms.uFogSun = fogSun;
  shader.uniforms.uFogSunColor = fogSunColor;
  base.call(this, shader, renderer);
};
