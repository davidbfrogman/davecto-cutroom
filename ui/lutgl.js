/*
  WebGL2 preview renderer: draws a cropped video frame through up to two 3D
  LUTs (conversion, then look), the same .cube files ffmpeg's lut3d uses.
  Falls back to a plain 2D canvas (no LUT) without WebGL2.
*/

const VS = `#version 300 es
in vec2 a_pos;
uniform vec4 u_crop;            // x, y, w, h in 0..1 of the source frame
out vec2 v_uv;
void main() {
  vec2 p = a_pos * 0.5 + 0.5;
  v_uv = vec2(u_crop.x + p.x * u_crop.z, u_crop.y + (1.0 - p.y) * u_crop.w);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler3D u_lut0, u_lut1;
uniform float u_n0, u_n1;       // LUT sizes; 0 = off
uniform float u_gain, u_alpha;
out vec4 o;
vec3 lut(sampler3D l, float n, vec3 c) { return texture(l, clamp(c, 0.0, 1.0) * (n - 1.0) / n + 0.5 / n).rgb; }
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;
  if (u_n0 > 0.0) c = lut(u_lut0, u_n0, c);
  if (u_n1 > 0.0) c = lut(u_lut1, u_n1, c);
  o = vec4(c * u_gain, u_alpha);
}`;

export function parseCube(text) {
  let size = 0;
  const data = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1]);
    else if (/^[-\d.]/.test(line)) { const k = line.split(/\s+/); data.push(+k[0], +k[1], +k[2]); }
  }
  return size && data.length === size ** 3 * 3 ? { size, data: new Float32Array(data) } : null;
}

export class GLView {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    this.gl = gl;
    if (!gl) { this.ctx = canvas.getContext('2d'); return; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = Object.fromEntries(['u_crop', 'u_tex', 'u_lut0', 'u_lut1', 'u_n0', 'u_n1', 'u_gain', 'u_alpha'].map(n => [n, gl.getUniformLocation(prog, n)]));
    gl.uniform1i(this.u.u_tex, 0);
    gl.uniform1i(this.u.u_lut0, 1);
    gl.uniform1i(this.u.u_lut1, 2);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.luts = [null, null];
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** slot 0 = conversion, 1 = look. cube = parsed .cube or null. */
  setLut(slot, cube) {
    const gl = this.gl;
    if (!gl) return;
    if (this.luts[slot]) gl.deleteTexture(this.luts[slot].tex);
    this.luts[slot] = null;
    if (!cube) return;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1 + slot);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, cube.size, cube.size, cube.size, 0, gl.RGB, gl.FLOAT, cube.data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.activeTexture(gl.TEXTURE0);
    this.luts[slot] = { tex, size: cube.size };
  }

  resize(w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }

  clear() {
    if (this.gl) { this.gl.viewport(0, 0, this.canvas.width, this.canvas.height); this.gl.clearColor(0.08, 0.075, 0.063, 1); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
    else { this.ctx.fillStyle = 'rgb(20 19 16)'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
  }

  /** Draw a video (or image) cropped to crop {x,y,w,h} in source pixels. */
  draw(media, crop, { alpha = 1, gain = 1, lut = true } = {}) {
    const vw = media.videoWidth || media.naturalWidth, vh = media.videoHeight || media.naturalHeight;
    if (!vw || !vh) return false;
    if (!this.gl) {
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(media, crop.x, crop.y, crop.w, crop.h, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.globalAlpha = 1;
      return true;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media); } catch { return false; }
    gl.uniform4f(this.u.u_crop, crop.x / vw, crop.y / vh, crop.w / vw, crop.h / vh);
    for (const slot of [0, 1]) {
      const l = lut ? this.luts[slot] : null;
      gl.uniform1f(slot ? this.u.u_n1 : this.u.u_n0, l ? l.size : 0);
      if (l) { gl.activeTexture(gl.TEXTURE1 + slot); gl.bindTexture(gl.TEXTURE_3D, l.tex); }
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.u.u_gain, gain);
    gl.uniform1f(this.u.u_alpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
