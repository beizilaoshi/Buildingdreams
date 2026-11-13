import type { Settings } from '../../shared/types';

export const SCENE_QUALITY = {
  low: { fps: 24, dpr: 1, pixels: 1_000_000 },
  balanced: { fps: 30, dpr: 1.25, pixels: 1_800_000 },
  high: { fps: 45, dpr: 1.5, pixels: 2_400_000 },
} as const;
export function sceneResolution(width: number, height: number, dpr: number, quality: Settings['backgroundQuality']) {
  const cap = SCENE_QUALITY[quality];
  const scale = Math.min(dpr, cap.dpr, Math.sqrt(cap.pixels / Math.max(1, width * height)));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))] as const;
}
/** CSS background sizing/position, expressed as a normalized image rectangle. */
export function imageRectangle(width: number, height: number, imageWidth: number, imageHeight: number, fit: Settings['wallpaperFit'], x: number, y: number) {
  const ratio = fit === 'cover' ? Math.max(width / imageWidth, height / imageHeight) : Math.min(width / imageWidth, height / imageHeight);
  const w = fit === 'stretch' ? 1 : imageWidth * ratio / width;
  const h = fit === 'stretch' ? 1 : imageHeight * ratio / height;
  return [(1 - w) * x / 100, (1 - h) * y / 100, w, h] as const;
}
export function liveSceneEnabled(settings: Settings, reduced: boolean, hidden: boolean, covered: boolean) {
  return settings.backgroundStyle === 'image' && settings.backgroundAnimation !== 'off' && settings.backgroundMotionIntensity > 0 && !settings.reducedMotion && !reduced && !hidden && !covered;
}
export function sceneEffect(settings: Settings): 0 | 1 | 2 {
  const effect = settings.backgroundEffect === 'auto'
    ? settings.wallpaper === 'builtin:cloud-dawn' || settings.wallpaper === 'builtin:sakura-night' ? 'petals'
    : settings.wallpaper === 'builtin:moon-lake' || settings.wallpaper === 'builtin:aurora' ? 'stars' : 'none'
    : settings.backgroundEffect;
  return effect === 'stars' ? 1 : effect === 'petals' ? 2 : 0;
}

const vertexSource = `attribute vec2 position; varying vec2 screenUV;
void main(){ screenUV=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.); }`;
const fragmentSource = `precision mediump float;
varying vec2 screenUV; uniform sampler2D picture; uniform vec4 imageRect;
uniform float time, intensity, painterly, effect; uniform vec2 pointer; uniform vec3 backdrop;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 uv=(screenUV-imageRect.xy)/imageRect.zw;
 if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.){gl_FragColor=vec4(backdrop,1.);return;}
 // Image-space masks keep the horizon and the architecture on the right stable.
 float left=1.-smoothstep(.62,.87,uv.x);
 float sky=(1.-smoothstep(.32,.53,uv.y))*left;
 float near=smoothstep(.55,1.,uv.y);
 float water=smoothstep(.55,.61,uv.y)*(1.-smoothstep(.82,.91,uv.y))*left*painterly;
 float depth=mix(.12,.95,near)*mix(.4,1.,left);
 vec2 displacement=pointer*.009*depth;
 displacement.x+=sin(time*.22+uv.y*4.)*sky*.0025;
 displacement.y+=cos(time*.17+uv.x*3.)*sky*.0008;
 displacement.x+=sin(uv.y*170.+time*1.7)*water*.0023;
 displacement.y+=sin(uv.x*85.+time*.8)*water*.00065;
 vec3 color=texture2D(picture,clamp(uv+displacement*intensity,vec2(.001),vec2(.999))).rgb;
 if(effect>.5&&effect<1.5&&uv.y<.48){
  vec2 grid=vec2(36.,18.);vec2 cell=floor(uv*grid);float seed=hash(cell);
  vec2 center=vec2(hash(cell+1.),hash(cell+2.))*.7+.15;
  float star=(1.-smoothstep(.008,.045,length((fract(uv*grid)-center)*vec2(1.,.7))))*step(.92,seed);
  color+=vec3(.65,.72,1.)*star*(.3+.7*pow(sin(time*.9+seed*30.)*.5+.5,3.))*intensity;
 }
 if(effect>1.5){
  vec2 flow=uv+vec2(sin(time*.25)*.025,-time*.018);vec2 grid=vec2(10.,7.);vec2 cell=floor(flow*grid);
  float seed=hash(cell);vec2 p=fract(flow*grid)-vec2(.25+seed*.5,.5);
  float petal=(1.-smoothstep(.025,.065,length(p*vec2(1.,1.8))))*step(.83,seed);
  color=mix(color,vec3(1.,.76,.86),petal*.55*intensity);
 }
 gl_FragColor=vec4(color,1.);
}`;

/** One application-owned controller. All scene resources/listeners are released on page exit. */
export class LiveBackground {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private settings: Settings | null = null;
  private source = '';
  private generation = 0;
  private imageSize: readonly [number, number] = [1, 1];
  private ready = false;
  private disposed = false;
  private lost = false;
  private frame = 0;
  private renderedAt = 0;
  private elapsed = 0;
  private drawn = 0;
  private pointer = [0, 0];
  private target = [0, 0];
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private observer: MutationObserver;
  constructor(private host: HTMLElement) {
    this.canvas.className = 'live-background';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.state = 'static';
    this.host.append(this.canvas);
    document.addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.sync);
    window.addEventListener('resize', this.resize);
    window.addEventListener('pagehide', this.dispose);
    this.media.addEventListener('change', this.sync);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.observer = new MutationObserver(this.sync);
    // Opening and the game-ready overlay cover the background; pause work behind them.
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    this.observer.observe(document.body, { childList: true });
    this.initialize();
  }
  configure(settings: Settings, source: string) {
    if (this.disposed) return;
    this.settings = settings;
    if (source !== this.source) {
      this.source = source;
      this.load(source);
    }
    this.resize();
    this.sync();
  }
  private initialize() {
    try {
      const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl) return;
      this.gl = gl;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type); if (!shader) throw Error('shader');
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw Error('shader compile'); }
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram(); if (!program) throw Error('program');
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw Error('shader link'); }
      this.program = program; gl.useProgram(program);
      this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.uniforms.clear();
      for (const name of ['picture','imageRect','time','intensity','painterly','effect','pointer','backdrop']) this.uniforms.set(name, gl.getUniformLocation(program, name));
    } catch { this.releaseGL(); }
  }
  private load(source: string) {
    const generation = ++this.generation;
    this.ready = false; this.canvas.hidden = true; this.sync();
    if (!this.gl || !this.program || this.lost) return;
    const image = new Image();
    image.onload = () => {
      if (this.disposed || generation !== this.generation || this.lost || !this.gl) return;
      const gl = this.gl;
      let pendingTexture: WebGLTexture | null = null;
      try {
        const max = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        let upload: HTMLImageElement | HTMLCanvasElement = image;
        if (Math.max(image.width, image.height) > max) {
          const scaled = document.createElement('canvas'), ratio = max / Math.max(image.width, image.height);
          scaled.width = Math.max(1, Math.round(image.width * ratio)); scaled.height = Math.max(1, Math.round(image.height * ratio));
          scaled.getContext('2d')!.drawImage(image, 0, 0, scaled.width, scaled.height); upload = scaled;
        }
        const texture = gl.createTexture(); if (!texture) return;
        pendingTexture = texture;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, upload);
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(texture); return; }
        if (this.texture) gl.deleteTexture(this.texture);
        this.texture = texture; pendingTexture = null; this.imageSize = [image.width, image.height]; this.ready = true;
        this.canvas.dataset.source = source; this.resize(); this.sync();
      } catch { if (pendingTexture) gl.deleteTexture(pendingTexture); this.ready = false; this.sync(); }
    };
    image.onerror = () => { if (generation === this.generation) { this.ready = false; this.sync(); } };
    image.src = source;
  }
  private covered() { return document.documentElement.classList.contains('opening-active') || !!document.querySelector('.launch-snake[open]'); }
  private sync = () => {
    const active = !!this.settings && this.ready && !this.lost && liveSceneEnabled(this.settings, this.media.matches, document.hidden, this.covered());
    if (!active) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0; this.renderedAt = 0; this.canvas.hidden = true;
      this.canvas.dataset.state = this.lost ? 'context-lost' : 'static';
      return;
    }
    if (this.canvas.hidden) this.draw();
    this.canvas.hidden = false; this.canvas.dataset.state = 'running';
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };
  private resize = () => {
    if (!this.settings || !this.gl || this.disposed) return;
    const [w,h] = sceneResolution(this.host.clientWidth, this.host.clientHeight, devicePixelRatio, this.settings.backgroundQuality);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  };
  private onPointer = (event: PointerEvent) => { this.target = [event.clientX / innerWidth * 2 - 1, event.clientY / innerHeight * 2 - 1]; };
  private tick = (now: number) => {
    this.frame = 0;
    if (!this.settings || this.canvas.hidden || !this.ready || !this.gl || !this.program) return;
    const interval = 1000 / SCENE_QUALITY[this.settings.backgroundQuality].fps;
    if (!this.renderedAt || now - this.renderedAt >= interval - .5) {
      const delta = this.renderedAt ? Math.min(.1, (now - this.renderedAt) / 1000) : 0;
      this.elapsed += delta * this.settings.backgroundMotionSpeed; this.renderedAt = now;
      const follow = 1 - Math.exp(-delta * 5);
      for (let i=0;i<2;i++) this.pointer[i] += ((this.settings.backgroundAnimation === 'interactive' ? this.target[i] : 0) - this.pointer[i]) * follow;
      this.draw();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  private draw() {
    const gl = this.gl!, s = this.settings!;
    const uniform = (name: string) => this.uniforms.get(name)!;
    gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(uniform('picture'), 0);
    gl.uniform4fv(uniform('imageRect'), [...imageRectangle(this.host.clientWidth, this.host.clientHeight, ...this.imageSize, s.wallpaperFit, s.wallpaperPositionX, s.wallpaperPositionY)]);
    gl.uniform1f(uniform('time'), this.elapsed); gl.uniform1f(uniform('intensity'), s.backgroundMotionIntensity);
    gl.uniform1f(uniform('painterly'), ['builtin:moon-lake','builtin:sakura-night','builtin:cloud-dawn'].includes(s.wallpaper) ? 1 : 0);
    gl.uniform1f(uniform('effect'), sceneEffect(s)); gl.uniform2f(uniform('pointer'), this.pointer[0], this.pointer[1]);
    gl.uniform3fv(uniform('backdrop'), s.backgroundColor.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.canvas.dataset.frames = String(++this.drawn);
    this.canvas.dataset.pointer = this.pointer.join(',');
  }
  private contextLost = (event: Event) => {
    event.preventDefault(); this.lost = true; ++this.generation; this.ready = false;
    // Context loss invalidates every handle; deleting old handles after restoration contaminates its error state.
    this.gl = null; this.program = null; this.buffer = null; this.texture = null; this.uniforms.clear();
    this.sync();
  };
  private contextRestored = () => { if (this.disposed) return; this.lost = false; this.releaseGL(); this.initialize(); this.load(this.source); };
  private releaseGL() {
    if (this.gl) { if(this.texture)this.gl.deleteTexture(this.texture);if(this.buffer)this.gl.deleteBuffer(this.buffer);if(this.program)this.gl.deleteProgram(this.program); }
    this.texture = null; this.buffer = null; this.program = null; this.gl = null;
  }
  dispose = () => {
    this.disposed = true; ++this.generation;
    if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;
    document.removeEventListener('pointermove', this.onPointer); document.removeEventListener('visibilitychange', this.sync);
    window.removeEventListener('resize', this.resize); window.removeEventListener('pagehide', this.dispose);
    this.media.removeEventListener('change', this.sync); this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    this.releaseGL(); this.canvas.remove();
  };
}
let scene: LiveBackground | undefined;
export function applyLiveBackground(settings: Settings, source: string) {
  const host = document.querySelector<HTMLElement>('#wallpaper');
  if (!host) return;
  if (!scene) scene = new LiveBackground(host);
  scene.configure(settings, source);
}
