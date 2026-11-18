import { Mesh, PolygonBatcher, Position2Attribute, Shader, SkeletonRenderer } from '@esotericsoftware/spine-webgl';

const precision = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif`;

const maskVertex = `${precision}
attribute vec2 a_position;
attribute vec4 a_color;
attribute vec2 a_texCoords;
uniform mat4 u_projection;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
  gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
  v_color = a_color;
  v_uv = a_texCoords;
}`;

const maskFragment = `${precision}
uniform sampler2D u_texture;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
  if (texture2D(u_texture, v_uv).a * v_color.a < 0.5 / 255.0) discard;
  gl_FragColor = vec4(v_color.rgb, 1.0);
}`;

const edgeVertex = `${precision}
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`;

const edgeFragment = `${precision}
uniform sampler2D u_mask;
uniform vec2 u_offset;
varying vec2 v_uv;
bool changesAt(vec3 center, vec2 offset) {
  vec3 neighbor = texture2D(u_mask, v_uv + offset).rgb;
  return any(greaterThan(abs(center - neighbor), vec3(0.5 / 255.0)));
}
void main() {
  vec3 center = texture2D(u_mask, v_uv).rgb;
  vec2 dx = vec2(u_offset.x, 0.0);
  vec2 dy = vec2(0.0, u_offset.y);
  if (!(changesAt(center, dx) || changesAt(center, -dx) ||
        changesAt(center, dy) || changesAt(center, -dy))) discard;
  gl_FragColor = vec4(1.0);
}`;

export class SceneOutlines {
  constructor(context) {
    this.context = context;
    this.maskShader = new Shader(context, maskVertex, maskFragment);
    this.edgeShader = new Shader(context, edgeVertex, edgeFragment);
    this.batcher = new PolygonBatcher(context, false);
    this.skeletonRenderer = new SkeletonRenderer(context, false);
    this.screenTriangle = new Mesh(context, [new Position2Attribute()], 3, 0);
    this.screenTriangle.setVertices([-1, -1, 3, -1, -1, 3]);
    this.restore();
    context.addRestorable(this);
  }

  restore() {
    const { gl } = this.context;
    this.mask = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    this.width = this.height = 0;
  }

  resize(width, height) {
    if (this.width === width && this.height === height) return;
    const { gl } = this.context;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.mask, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('无法创建选区轮廓缓冲区。');
    this.width = width;
    this.height = height;
  }

  draw(skeleton, projection, ratio) {
    const { gl } = this.context;
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.disable(gl.DITHER);
    try {
      this.resize(width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.maskShader.bind();
      this.maskShader.setUniformi('u_texture', 0);
      this.maskShader.setUniform4x4f('u_projection', projection);
      this.batcher.begin(this.maskShader);
      gl.disable(gl.BLEND);
      try {
        // Each attachment writes its own ID so touching selections keep a shared outline.
        let id = 0;
        this.skeletonRenderer.draw(this.batcher, skeleton, -1, -1, (vertices, length, stride) => {
          id++;
          const red = (id & 255) / 255, green = ((id >> 8) & 255) / 255, blue = ((id >> 16) & 255) / 255;
          for (let i = 2; i < length; i += stride) {
            vertices[i] = red;
            vertices[i + 1] = green;
            vertices[i + 2] = blue;
          }
        });
      } finally {
        this.batcher.end();
      }
    } finally {
      this.maskShader.unbind();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.DITHER);
    }

    // Leave only the outline on the drawing buffer for the preview overlay to copy.
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.edgeShader.bind();
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.mask);
      this.edgeShader.setUniformi('u_mask', 0);
      const offset = Math.max(1, Math.round(ratio));
      this.edgeShader.setUniform2f('u_offset', offset / width, offset / height);
      this.screenTriangle.draw(this.edgeShader, gl.TRIANGLES);
    } finally {
      this.edgeShader.unbind();
    }
  }

  dispose() {
    const { gl } = this.context;
    this.context.removeRestorable(this);
    this.maskShader.dispose();
    this.edgeShader.dispose();
    this.batcher.dispose();
    this.screenTriangle.dispose();
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.mask);
  }
}
