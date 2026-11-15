// A planet in one fragment shader (WebGL2, no library): orthographic sphere sampled from an equirectangular texture.
// 'dem' worlds are shaded from our own DEM PNGs (hillshade from the real heights + an elevation colour ramp);
// 'night' is NASA's VIIRS Black Marble. project()/unproject() use the same rotation, so DOM pins land on the surface.
const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uLon, uLat, uR, uKind, uBump; uniform vec3 uRim, uLo, uMid, uHi; uniform vec2 uTexel;
out vec4 o;
const float PI = 3.14159265;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * min(uRes.x, uRes.y));
  float d = length(p);
  float edge = fwidth(d);
  // thin atmosphere halo outside the limb (premultiplied alpha)
  float halo = exp(-max(d - uR, 0.0) * 30.0) * 0.5 * smoothstep(uR + 0.2, uR, d) * (0.3 + 0.7 * smoothstep(-0.4, 0.6, dot(normalize(p + 1e-5), normalize(vec2(0.5, 0.42))))); // halo on the lit side
  if (d > uR + edge) { o = vec4(uRim * halo, halo); return; }
  vec3 n = vec3(p / uR, sqrt(max(0.0, 1.0 - dot(p, p) / (uR * uR))));
  float cl = cos(uLat), sl = sin(uLat);
  vec3 w = vec3(n.x, n.y * cl + n.z * sl, -n.y * sl + n.z * cl);           // view -> body frame (tilt by latitude)
  float lat = asin(clamp(w.y, -1.0, 1.0)), lon = atan(w.x, w.z) + uLon;
  vec2 raw = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec2 dx = dFdx(raw), dy = dFdy(raw);
  dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);                    // no mip seam where longitude wraps
  vec2 uv = vec2(fract(raw.x), raw.y);
  vec3 L = normalize(vec3(0.5, 0.42, 0.6));                                 // sun: upper right (toward Earth), raking
  vec3 col;
  if (uKind < 0.5) {
    float h = textureGrad(uTex, uv, dx, dy).r;
    float he = textureGrad(uTex, uv + vec2(uTexel.x, 0.0), dx, dy).r - textureGrad(uTex, uv - vec2(uTexel.x, 0.0), dx, dy).r;
    float hn = textureGrad(uTex, uv - vec2(0.0, uTexel.y), dx, dy).r - textureGrad(uTex, uv + vec2(0.0, uTexel.y), dx, dy).r;
    vec3 east = normalize(vec3(w.z, 0.0, -w.x) + 1e-5), north = cross(w, east);
    vec3 nb = normalize(w - uBump * (he * east + hn * north));
    vec3 v = vec3(nb.x, nb.y * cl - nb.z * sl, nb.y * sl + nb.z * cl);   // body -> view
    float lam = max(dot(v, L), 0.0);
    vec3 base = mix(mix(uLo, uMid, smoothstep(0.0, 0.32, h)), uHi, smoothstep(0.3, 0.75, h));
    col = base * (0.015 + 1.3 * pow(lam, 1.25)); // a hard terminator: the night side goes nearly black
  } else {
    vec3 t = textureGrad(uTex, uv, dx, dy).rgb;
    float lights = smoothstep(0.22, 0.75, max(t.r, max(t.g, t.b)));
    float day = smoothstep(-0.05, 0.35, dot(n, L));
    col = t * vec3(0.55, 0.85, 1.05) * 1.7 + lights * vec3(1.0, 0.8, 0.5) * 1.7 * (1.0 - day);
    col += day * vec3(0.05, 0.16, 0.22);
  }
  // HUD graticule every 30°, faint
  vec2 g = vec2(lon, lat) * (180.0 / PI) / 30.0;
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-4);
  col += (1.0 - min(min(gd.x, gd.y), 1.0)) * 0.05 * uRim * smoothstep(0.1, 0.6, n.z);
  float fres = pow(1.0 - n.z, 3.0);
  col += uRim * fres * (0.18 + 1.3 * max(dot(n, L), 0.0)) + vec3(1.0, 0.92, 0.8) * pow(fres, 3.0) * pow(max(dot(n, L), 0.0), 2.0) * 0.9; // hot lit limb
  float a = smoothstep(uR + edge, uR - edge, d);
  o = vec4(col * a + uRim * halo * (1.0 - a), a + halo * (1.0 - a));
}`;

export type PlanetKind = 'dem' | 'night';
export interface PlanetStyle { kind: PlanetKind; rim: string; lo?: string; mid?: string; hi?: string; bump?: number }
const rgb = (hex = '#000000') => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const D2R = Math.PI / 180;
export const R_FRAC = 0.86; // sphere radius as a fraction of half the canvas' shorter side (room for the halo)

export class Planet {
  lon = 0; lat = 0; // degrees at the centre of the disc
  private gl: WebGL2RenderingContext; private u: Record<string, WebGLUniformLocation | null> = {}; private ready = false;
  constructor(private canvas: HTMLCanvasElement, src: string, private style: PlanetStyle, onReady?: () => void) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const sh = (type: number, code: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'shader link failed');
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['uTex', 'uRes', 'uLon', 'uLat', 'uR', 'uKind', 'uBump', 'uRim', 'uLo', 'uMid', 'uHi', 'uTexel']) this.u[k] = gl.getUniformLocation(prog, k);
    gl.uniform3fv(this.u.uRim, rgb(style.rim)); gl.uniform3fv(this.u.uLo, rgb(style.lo)); gl.uniform3fv(this.u.uMid, rgb(style.mid)); gl.uniform3fv(this.u.uHi, rgb(style.hi));
    gl.uniform1f(this.u.uKind, style.kind === 'dem' ? 0 : 1); gl.uniform1f(this.u.uBump, style.bump ?? 6); gl.uniform1f(this.u.uR, R_FRAC);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const img = new Image();
    img.src = src;
    img.decode().then(() => {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); // DEM luminance is height: keep it raw
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform2f(this.u.uTexel, 1 / img.width, 1 / img.height);
      this.ready = true;
      this.render();
      onReady?.();
    }).catch(() => {}); // no texture: the CSS fallback disc under the canvas stays visible
  }
  get loaded() { return this.ready; }
  dispose() { this.ready = false; this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } // frees the context slot now
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1), c = this.canvas, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  render() {
    if (!this.ready) return;
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uLon, this.lon * D2R); gl.uniform1f(this.u.uLat, this.lat * D2R);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // lat/lon (degrees) -> CSS px inside the canvas, and whether it faces the viewer
  project(latDeg: number, lonDeg: number) {
    const la = latDeg * D2R, lo = (lonDeg - this.lon) * D2R, cl = Math.cos(this.lat * D2R), sl = Math.sin(this.lat * D2R);
    const w = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    const n = [w[0], w[1] * cl - w[2] * sl, w[1] * sl + w[2] * cl];
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, s = 0.5 * Math.min(W, H) * R_FRAC;
    return { x: W / 2 + n[0] * s, y: H / 2 - n[1] * s, front: n[2] };
  }
  // CSS px -> [lat, lon] degrees, or null off the disc
  unproject(x: number, y: number): [number, number] | null {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, s = 0.5 * Math.min(W, H) * R_FRAC;
    const px = (x - W / 2) / s, py = (H / 2 - y) / s, r2 = px * px + py * py;
    if (r2 > 1) return null;
    const n = [px, py, Math.sqrt(1 - r2)], cl = Math.cos(this.lat * D2R), sl = Math.sin(this.lat * D2R);
    const w = [n[0], n[1] * cl + n[2] * sl, -n[1] * sl + n[2] * cl];
    const lon = ((Math.atan2(w[0], w[2]) / D2R + this.lon + 540) % 360) - 180;
    return [Math.asin(Math.max(-1, Math.min(1, w[1]))) / D2R, lon];
  }
}
