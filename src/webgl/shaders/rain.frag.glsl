uniform vec3 uColor;
uniform float uOpacity;

varying float vAlpha;

void main() {
  // Slanted streak inside the point sprite. The shear matches the lateral
  // push in the vertex stage — a vertical streak on rain that is visibly
  // blowing sideways reads as a glitch. Narrower than before, so the drop is
  // a hard line instead of a soft smear.
  // The sprite is square, so the streak's width is set ENTIRELY by this x
  // threshold — at 0.34 it covered two thirds of the quad and every drop
  // rendered as a fat rounded block. 0.12 is a line.
  vec2 pc = gl_PointCoord - 0.5;
  pc.x += pc.y * 0.42;
  float streak = smoothstep(0.12, 0.0, abs(pc.x)) * smoothstep(0.5, 0.44, abs(pc.y));
  float a = streak * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
