// The one shader every geometry tool uses: each output pixel looks up its source position through
// a 3x3 matrix (output pixel -> input pixel, y-down, pixel centres at +0.5). Crops, quarter turns,
// and flips land exactly on input pixel centres and copy them (nearest, lossless). Fine rotations
// and perspective use Catmull-Rom bicubic interpolation, which keeps edges crisper than bilinear.
export const WARP = `
uniform sampler2D u_image;
uniform mat3 u_map;
uniform float u_cubic;

vec4 catmullRomWeights(float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * vec4(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
}

vec3 bicubic(vec2 p) {
  ivec2 size = textureSize(u_image, 0);
  vec2 q = p - 0.5;
  vec2 base = floor(q);
  vec2 f = q - base;
  vec4 wx = catmullRomWeights(f.x), wy = catmullRomWeights(f.y);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      ivec2 at = clamp(ivec2(base) + ivec2(i - 1, j - 1), ivec2(0), size - 1);
      row += texelFetch(u_image, at, 0).rgb * wx[i];
    }
    sum += row * wy[j];
  }
  return sum;
}

void main() {
  vec3 q = vec3(gl_FragCoord.xy, 1.0) * u_map;
  vec2 p = q.xy / q.z;
  ivec2 size = textureSize(u_image, 0);
  vec3 rgb = u_cubic > 0.5
    ? bicubic(p)
    : texelFetch(u_image, clamp(ivec2(floor(p)), ivec2(0), size - 1), 0).rgb;
  outColor = vec4(rgb, 1.0);
}`;
