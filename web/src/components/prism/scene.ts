// The WebGL scene behind the landing page: one camera inside a cylinder of tiles, a pane of
// giant words, a glass prism that bends them, a row of curved cards, a ring of liquid words,
// a bar that turns the page from dark to ivory, and the mark, landing at the end.
//
// It knows nothing about scrolling or React. Each frame it is handed the page's cues
// (timeline.ts) and draws them. Everything that can be seen is made here from text and numbers
// — there are no image files.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { markShapes } from "../../lib/mark";
import { clamp, eBack, eOut, lerp, range, smooth, type Cues } from "./timeline";

export interface ServiceCard {
  /** what the agent gets, in the owner's words */
  name: string;
  /** the catalog's route id */
  route: string;
  /** USDC per call, as the catalog prints it */
  price: string;
}

export interface SceneContent {
  /** the hero sentence, one entry per line */
  sentence: string[];
  /** the word the sentence turns into over the cards */
  word: string;
  /** the words that flow around the camera in the rules act */
  rules: string[];
  cards: ServiceCard[];
  /** small labels drawn on the cards */
  perCall: string;
  source: string;
}

/** Values the intro animates before scrolling takes over. */
export interface SceneState {
  camZ: number;
  ca: number;
  bloom: number;
  tint: number;
}

export interface PrismScene {
  state: SceneState;
  /** Draw one frame. `vel` is scroll velocity in -1..1, `mouse` in -1..1 on both axes. */
  render(c: Cues, s: number, vel: number, mouse: { x: number; y: number }, dt: number): void;
  resize(): void;
  setContent(content: SceneContent): void;
  dispose(): void;
}

const NOISE = /* glsl */ `
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
`;

/** Where on the rules' strip the camera looks, as an offset in strip lengths. The camera
 *  sits at the cylinder's centre looking down -z, which is u = 0.5; the strip is laid twice
 *  round, so that is one whole strip — no offset. */
const RULES_FRONT = 0;

const PASS_VS = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

// The palette, as the page's CSS has it.
const FOREST_DEEP = "#14261D";
const IVORY = "#F4EFE6";
const GOLD = "#C9A86A";

/** Lines of text as a white-on-transparent texture; the shaders read its alpha. */
function textTexture(lines: string[], font: string, { w = 4096, h = 1024, fill = 0.94, align = "left" as "left" | "center", lineHeight = 1.12 } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  let size = (h * 0.86) / (lines.length * lineHeight);
  const setFont = () => {
    ctx.font = font.replace("{size}", `${size}px`);
  };
  setFont();
  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  let ww = widest();
  if (ww > w * fill) {
    size *= (w * fill) / ww;
    setFont();
    ww = widest();
  }
  const block = size * lineHeight * lines.length;
  const x0 = align === "center" ? w / 2 : (w - ww) / 2;
  ctx.textAlign = align === "center" ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  lines.forEach((line, i) => {
    // 0.78: where the baseline sits inside a line box, for the faces used here
    ctx.fillText(line, x0, (h - block) / 2 + size * lineHeight * i + size * 0.86);
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** The rules' words on one long strip that wraps around the camera. Returns where along the
 *  strip (0..1) each word's middle is, so the scene can turn the right one to the front. */
function rulesTexture(words: string[]) {
  const w = 8192;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const sep = "  ·  ";
  const line = words.map((x) => x + sep).join("");
  let size = h * 0.8;
  const setFont = () => {
    ctx.font = `500 ${size}px "Kalnia", Georgia, serif`;
  };
  setFont();
  let ww = ctx.measureText(line).width;
  // the strip repeats, so the words have to fill it exactly: no gap at the seam
  size *= w / ww;
  setFont();
  ww = ctx.measureText(line).width;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(line, 0, h / 2 + size * 0.36);
  const centers: number[] = [];
  let x = 0;
  for (const word of words) {
    const wordW = ctx.measureText(word).width;
    centers.push((x + wordW / 2) / ww);
    x += ctx.measureText(word + sep).width;
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return { tex: t, centers };
}

/** A service, as a card: what it is, what it costs, where the price was read. */
function cardTexture(card: ServiceCard, index: number, total: number, content: SceneContent) {
  const w = 1280;
  const h = 720;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = FOREST_DEEP;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(244,239,230,.16)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);

  const pad = 72;
  ctx.textBaseline = "alphabetic";
  // the corner labels
  ctx.font = `500 28px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillStyle = "rgba(244,239,230,.62)";
  ctx.textAlign = "left";
  ctx.fillText(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, pad, pad + 22);
  ctx.textAlign = "right";
  ctx.fillText(card.route, w - pad, pad + 22);

  // the price — the one large thing on the card
  ctx.textAlign = "left";
  ctx.fillStyle = IVORY;
  ctx.font = `500 236px "JetBrains Mono", ui-monospace, monospace`;
  const priceW = ctx.measureText(card.price).width;
  ctx.fillText(card.price, pad - 8, 392);
  ctx.font = `500 34px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText("USDC", pad + priceW + 22, 322);
  ctx.fillStyle = "rgba(244,239,230,.62)";
  ctx.fillText(content.perCall, pad + priceW + 22, 372);

  // the rule, the one gold thing
  ctx.fillStyle = GOLD;
  ctx.fillRect(pad, 470, w - pad * 2, 3);

  ctx.fillStyle = IVORY;
  ctx.font = `400 88px "Questrial", system-ui, sans-serif`;
  ctx.fillText(card.name, pad - 4, 596);
  ctx.font = `500 26px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillStyle = "rgba(244,239,230,.62)";
  ctx.fillText(content.source, pad, 654);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The mark, extruded. Returns the body and the limit apart so the limit can be gold. */
function markGeometry() {
  const m = markShapes(3);
  const body =
    m.paths.map((d) => `<path d="${d}"/>`).join("") + m.discs.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`).join("");
  const limit = `<rect x="${m.limit.x}" y="${m.limit.y}" width="${m.limit.width}" height="${m.limit.height}"/>`;
  const loader = new SVGLoader();
  const extrude = (inner: string, depth: number) => {
    const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.35, bevelSegments: 3, curveSegments: 24 });
    // SVG's y runs down; centre on the mark's own centre (x 114, the axis at y 50.5)
    geo.translate(-114, -50.5, -depth / 2);
    geo.scale(1, -1, 1);
    geo.computeVertexNormals();
    return geo;
  };
  return { body: extrude(body, 9), limit: extrude(limit, 11) };
}

export function createPrismScene(canvas: HTMLCanvasElement, initial: SceneContent): PrismScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const PR = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(PR);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 200);
  const state: SceneState = { camZ: 10, ca: 0.0018, bloom: 0.3, tint: 0 };
  camera.position.set(0, 0, state.camZ);
  scene.add(camera);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;

  const visH = (d: number) => 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visW = (d: number) => visH(d) * camera.aspect;

  const uTime = { value: 0 };
  const disposables: { dispose(): void }[] = [env, pmrem];

  /* ---------------- content: every texture comes from text ---------------- */
  let content = initial;
  let cardTex: THREE.CanvasTexture[] = [];
  let sentenceTex: THREE.CanvasTexture;
  let wordTex: THREE.CanvasTexture;
  let rulesTex: THREE.CanvasTexture;
  let ruleCenters: number[] = [];
  const makeTextures = () => {
    sentenceTex = textTexture(content.sentence, `400 {size} "Questrial", system-ui, sans-serif`, { lineHeight: 1.1 });
    wordTex = textTexture([content.word], `400 {size} "Questrial", system-ui, sans-serif`, { align: "center", fill: 0.8 });
    const rules = rulesTexture(content.rules);
    rulesTex = rules.tex;
    ruleCenters = rules.centers;
    cardTex = content.cards.map((card, i) => cardTexture(card, i, content.cards.length, content));
  };
  makeTextures();

  /* ---------------- the wall: the inside of a cylinder of tiles ---------------- */
  const COLS = 78;
  const ROWS = 16;
  const R = 20;
  const TILE = (2 * Math.PI * R) / COLS;
  const wall = new THREE.Group();
  wall.position.set(0, 0, 4);
  scene.add(wall);

  const wallU = {
    uTime,
    uForest: { value: 1 },
    uMosaic: { value: 0 },
    uIvory: { value: 0 },
    uDeep: { value: 0 },
    uImgA: { value: cardTex[0] as THREE.Texture },
    uImgB: { value: cardTex[0] as THREE.Texture },
    uImgMix: { value: 1 },
    uRows: { value: ROWS },
  };
  const tileMat = new THREE.ShaderMaterial({
    uniforms: wallU,
    vertexShader: /* glsl */ `
      attribute vec2 aCell; attribute float aRand;
      varying vec2 vUv; varying vec2 vCell; varying float vRand;
      void main(){ vUv=uv; vCell=aCell; vRand=aRand;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime,uForest,uMosaic,uIvory,uDeep,uImgMix,uRows;
      uniform sampler2D uImgA,uImgB;
      varying vec2 vUv; varying vec2 vCell; varying float vRand;
      void main(){
        vec2 cell = vCell;
        vec2 q = abs(vUv-.5); float edge = max(q.x,q.y);
        float gap = smoothstep(.482,.5,edge);
        float shade = 1.-edge*.4;
        float mid = exp(-pow((cell.y-uRows*.5)/5.,2.));
        float tStep = floor(uTime*.45 + vRand*9.);
        float rn = hash(cell + tStep*.37);
        /* hero: forest checker, flickering; one tile in twenty is gold */
        vec3 green = vec3(.007,.04,.025);
        vec3 lit = green*(.12+.75*pow(hash(cell+3.1+tStep),1.6));
        float isGold = step(.955, hash(cell*1.7+11.3));
        lit = mix(lit, vec3(.2,.125,.04)*(.1+.5*pow(hash(cell+5.2+tStep),2.)), isGold);
        vec3 forest = mix(vec3(.0025,.007,.005), lit, step(.5,rn));
        forest *= .25 + .85*mid;
        /* services: a blurred mosaic of the card in the centre */
        vec2 iuv = vec2(fract(cell.x/15.), cell.y/uRows) + (vUv-.5)*vec2(1./15.,1./uRows)*.9;
        /* a card is words, not a photograph: blurred far enough that only its light is left */
        vec3 img = mix(texture(uImgA,iuv,6.).rgb, texture(uImgB,iuv,6.).rgb, uImgMix);
        img = mix(img, img*vec3(.55,1.,.75), .6) * (.08 + .34*hash(cell+9.)) * (.45+.6*mid);
        /* proof: ivory paper */
        vec3 ivory = vec3(.905,.863,.791)*(.985+.015*hash(cell));
        /* rules: the deepest green, a few tiles breathing */
        vec3 deep = mix(vec3(.002,.006,.0045), vec3(.012,.085,.05), hash(cell+tStep*.2)*.85) * (.3+.8*mid);
        vec3 col = vec3(0.);
        col = mix(col,forest,uForest); col = mix(col,img,uMosaic); col = mix(col,deep,uDeep); col = mix(col,ivory,uIvory);
        col *= mix(shade,1.,uIvory);
        col = mix(col, mix(vec3(0.), vec3(.77,.72,.64), uIvory), gap);
        gl_FragColor = vec4(col,1.);
      }`,
  });
  const tileGeo = new THREE.PlaneGeometry(TILE, TILE);
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, COLS * ROWS);
  {
    const aCell = new Float32Array(COLS * ROWS * 2);
    const aRand = new Float32Array(COLS * ROWS);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    let i = 0;
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r < ROWS; r++) {
        const th = ((c + 0.5) / COLS) * Math.PI * 2;
        rot.makeRotationY(th + Math.PI);
        m.copy(rot).setPosition(R * Math.sin(th), (r - ROWS / 2 + 0.5) * TILE, R * Math.cos(th));
        tiles.setMatrixAt(i, m);
        aCell[i * 2] = c;
        aCell[i * 2 + 1] = r;
        aRand[i] = Math.random();
        i++;
      }
    tileGeo.setAttribute("aCell", new THREE.InstancedBufferAttribute(aCell, 2));
    tileGeo.setAttribute("aRand", new THREE.InstancedBufferAttribute(aRand, 1));
    tiles.frustumCulled = false;
  }
  wall.add(tiles);
  disposables.push(tileGeo, tileMat);

  // Each tile has its own matrix, so two neighbours' shared edge is not bit-for-bit the same
  // line and a pixel of whatever is behind can show between them. Behind them is this: a
  // plain cylinder in the colour of the tiles' own gaps, so a crack is a gap like any other.
  // (On the ivory wall the crack used to be a black hairline, which the lens split to magenta.)
  const backGeo = new THREE.CylinderGeometry(R + 0.08, R + 0.08, ROWS * TILE + 2, COLS, 1, true);
  const backMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  wall.add(new THREE.Mesh(backGeo, backMat));
  disposables.push(backGeo, backMat);

  /* a fine grid and scattered crosshairs, just in front of the tiles */
  const gridU = { uCol: { value: new THREE.Color(1, 1, 1) }, uLineA: { value: 0.1 }, uPlusA: { value: 0.7 } };
  const gridGeo = new THREE.CylinderGeometry(R - 0.1, R - 0.1, ROWS * TILE, COLS, 1, true);
  const gridMat = new THREE.ShaderMaterial({
    uniforms: gridU,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: PASS_VS,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uCol; uniform float uLineA,uPlusA; varying vec2 vUv;
      void main(){
        vec2 c = vUv*vec2(${COLS * 2}.,${ROWS * 2}.);
        vec2 fw = fwidth(c);
        vec2 d = .5-abs(fract(c)-.5);
        float line = max(1.-smoothstep(0.,fw.x,d.x), 1.-smoothstep(0.,fw.y,d.y));
        vec2 ic = floor(c/4.+.5)*4.; vec2 g = c-ic;
        float on = step(.45, hash(ic*.173));
        float arm = .35;
        float plus = max((1.-smoothstep(0.,fw.x*1.2,abs(g.x)))*step(abs(g.y),arm),
                         (1.-smoothstep(0.,fw.y*1.2,abs(g.y)))*step(abs(g.x),arm))*on;
        gl_FragColor = vec4(uCol, line*uLineA + plus*uPlusA);
      }`,
  });
  wall.add(new THREE.Mesh(gridGeo, gridMat));
  disposables.push(gridGeo, gridMat);

  /* ---------------- the words: opaque, so the glass in front bends them ---------------- */
  const textU = { uA: { value: sentenceTex! as THREE.Texture }, uB: { value: wordTex! as THREE.Texture }, uMix: { value: 0 }, uOut: { value: 0 }, uGray: { value: 0 }, uTime };
  const textGeo = new THREE.PlaneGeometry(1, 1);
  const textMat = new THREE.ShaderMaterial({
    uniforms: textU,
    vertexShader: PASS_VS,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform sampler2D uA,uB; uniform float uMix,uOut,uGray,uTime; varying vec2 vUv;
      void main(){
        float n = fbm(vUv*vec2(5.,1.6)+vec2(uTime*.05,0.));
        float m = smoothstep(n-.12,n+.12,uMix*1.26-.13);
        float band = m*(1.-m)*4.;
        vec2 w = vec2((fbm(vUv*vec2(3.,9.)+uTime*.4)-.5)*.16*band, 0.);
        float al = mix(texture(uA,vUv+w).a, texture(uB,vUv+w).a, m);
        float o = smoothstep(n-.1,n+.1,uOut*1.22-.11);
        al *= 1.-o;
        if(al<.5) discard;
        vec3 col = mix(vec3(1.5,1.44,1.3), vec3(.15,.2,.17), uGray);
        col += band*vec3(1.9,1.2,.35);
        gl_FragColor = vec4(col,1.);
      }`,
  });
  const text = new THREE.Mesh(textGeo, textMat);
  scene.add(text);
  disposables.push(textGeo, textMat);

  /* ---------------- the prism: a triangle of glass ---------------- */
  const prismShape = (H: number, t: number) => {
    const s = (H * 2) / Math.sqrt(3);
    const cy = H / 3;
    const P: [number, number][] = [
      [0, H - cy],
      [s / 2, -cy],
      [-s / 2, -cy],
    ];
    const shape = new THREE.Shape();
    P.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const k = (H / 3 - t) / (H / 3);
    const hole = new THREE.Path();
    P.slice()
      .reverse()
      .forEach(([x, y], i) => (i ? hole.lineTo(x * k, y * k) : hole.moveTo(x * k, y * k)));
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  };
  const prismGeo = new THREE.ExtrudeGeometry(prismShape(4.4, 0.72), { depth: 0.7, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.12, bevelSegments: 6, curveSegments: 1 });
  prismGeo.center();
  prismGeo.computeVertexNormals();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1,
    thickness: 2.2,
    roughness: 0.03,
    ior: 1.7,
    dispersion: 7,
    iridescence: 0.35,
    iridescenceIOR: 1.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 0.55,
    specularIntensity: 0.8,
  });
  const prism = new THREE.Mesh(prismGeo, glass);
  scene.add(prism);
  disposables.push(prismGeo, glass);

  /* ---------------- the mark, for the last act ---------------- */
  const markGeo = markGeometry();
  const markBodyMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(IVORY), roughness: 0.34, clearcoat: 1, emissive: new THREE.Color(IVORY), emissiveIntensity: 0.07 });
  const markLimitMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(GOLD), roughness: 0.28, metalness: 0.5, clearcoat: 1, emissive: new THREE.Color(GOLD), emissiveIntensity: 0.12 });
  const mark = new THREE.Group();
  mark.add(new THREE.Mesh(markGeo.body, markBodyMat), new THREE.Mesh(markGeo.limit, markLimitMat));
  mark.visible = false;
  scene.add(mark);
  disposables.push(markGeo.body, markGeo.limit, markBodyMat, markLimitMat);

  /* ---------------- the cards: curved panels on an arc ---------------- */
  const PW = 5.4;
  const PH = (PW * 9) / 16;
  const panelGeo = new THREE.PlaneGeometry(PW, PH, 48, 1);
  disposables.push(panelGeo);
  const panelVS = /* glsl */ `
    uniform float uBend,uW; varying vec2 vUv;
    void main(){ vUv=uv; vec3 p=position; float nx=p.x/(uW*.5); p.z += nx*nx*uBend;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.); }`;
  const panelFS = /* glsl */ `
    ${NOISE}
    uniform sampler2D uMap; uniform float uReveal,uVel,uActive; varying vec2 vUv;
    void main(){
      vec2 b = floor(vUv*vec2(36.,20.));
      float r = hash(b+3.7);
      float th = uReveal*1.25-.12;
      if(r>th) discard;
      float rim = smoothstep(th-.1,th,r)*step(uReveal,.999);
      vec2 off = vec2(uVel*.04+.0012,0.);
      vec3 c = vec3(texture(uMap,vUv+off).r, texture(uMap,vUv).g, texture(uMap,vUv-off).b);
      c *= mix(.3,1.06,uActive);
      c += rim*vec3(1.2,.85,.4);
      gl_FragColor = vec4(c,1.);
    }`;
  const panels = cardTex.map((tex) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex as THREE.Texture }, uReveal: { value: 0 }, uVel: { value: 0 }, uActive: { value: 0 }, uBend: { value: 0.6 }, uW: { value: PW } },
      vertexShader: panelVS,
      fragmentShader: panelFS,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(panelGeo, mat);
    m.visible = false;
    scene.add(m);
    disposables.push(mat);
    return m;
  });

  /* ---------------- the bar: a line that widens until the page is ivory ---------------- */
  const barU = { uRes: { value: new THREE.Vector2(1, 1) }, uLen: { value: 0 }, uWid: { value: 0 }, uAlpha: { value: 0 }, uAng: { value: 1.08 }, uTime };
  const barGeo = new THREE.PlaneGeometry(2, 2);
  const barMat = new THREE.ShaderMaterial({
    uniforms: barU,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `void main(){gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec2 uRes; uniform float uLen,uWid,uAlpha,uAng,uTime;
      void main(){
        vec2 p = (gl_FragCoord.xy-.5*uRes)/uRes.y;
        float ca=cos(uAng), sa=sin(uAng);
        vec2 q = vec2(ca*p.x+sa*p.y, -sa*p.x+ca*p.y);
        float aa = 1.5/uRes.y;
        float m = (1.-smoothstep(uWid-aa,uWid+aa,abs(q.y))) * (1.-smoothstep(uLen-aa,uLen+aa,abs(q.x)));
        float n = fbm(q*vec2(1.3,2.2)+vec2(0.,uTime*.18));
        /* gold while it is a line, ivory once it is a surface */
        vec3 gold = vec3(.72,.5,.2);
        vec3 ivory = vec3(.905,.863,.791);
        float wide = smoothstep(.02,.5,uWid);
        vec3 col = mix(gold*(1.+.35*sin(q.x*7.+n*6.+uTime*.6)), ivory, wide);
        gl_FragColor = vec4(col, m*uAlpha);
      }`,
  });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.frustumCulled = false;
  bar.renderOrder = 999;
  scene.add(bar);
  disposables.push(barGeo, barMat);

  /* ---------------- the rules: words wrapped around the camera ---------------- */
  const rulesU = { uTex: { value: rulesTex! as THREE.Texture }, uWarp: { value: 1 }, uOff: { value: 0 }, uOp: { value: 0 }, uLum: { value: 1 }, uTime };
  const rulesGeo = new THREE.CylinderGeometry(8, 8, 15, 96, 1, true);
  const rulesMat = new THREE.ShaderMaterial({
    uniforms: rulesU,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: PASS_VS,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform sampler2D uTex; uniform float uWarp,uOff,uOp,uLum,uTime; varying vec2 vUv;
      void main(){
        /* the strip goes twice round; ten rows of it, the sixth at the camera's height */
        vec2 uv = vec2((1.-vUv.x)*2.+uOff, vUv.y*9.6+.7);
        float row = floor(uv.y);
        uv.x += (row-5.)*.37;
        vec2 l = vec2(uv.x, fract(uv.y));
        l.y = (l.y-.5)*1.12+.5;
        vec2 d = vec2(fbm(l*vec2(1.4,3.)+uTime*.3)-.5, fbm(l*vec2(2.2,2.)-uTime*.25+5.)-.5);
        l += d*uWarp*vec2(.3,.5);
        vec2 off = vec2(.0009+uWarp*.004, uWarp*.006);
        float r = texture(uTex,l+off).a, g = texture(uTex,l).a, b = texture(uTex,l-off).a;
        /* ivory letters; where they smear, one edge runs to gold and the other to green —
           the fringe stays inside the palette instead of splitting into red, green and blue */
        vec3 col = g*vec3(.98,.94,.84) + max(r-g,0.)*vec3(1.05,.7,.26) + max(b-g,0.)*vec3(.18,.6,.38);
        col *= uLum;
        gl_FragColor = vec4(col, max(r,max(g,b))*uOp);
      }`,
  });
  const rulesWord = new THREE.Mesh(rulesGeo, rulesMat);
  rulesWord.position.set(0, 0, 10);
  rulesWord.visible = false;
  scene.add(rulesWord);
  disposables.push(rulesGeo, rulesMat);

  /* ---------------- post ---------------- */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(PR);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 0.95);
  composer.addPass(bloom);
  // In linear light, before the output transform: colour fringing, the intro's tint, a vignette.
  const lensPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uCA: { value: 0 }, uTint: { value: 0 } },
    vertexShader: PASS_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uCA,uTint; varying vec2 vUv;
      void main(){
        vec2 d = vUv-.5; float r2 = dot(d,d);
        vec2 off = d*uCA*(.6+r2*3.);
        vec3 c = vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
        float lum = dot(c,vec3(.3,.59,.11));
        c = mix(c, mix(vec3(.004,.03,.018), vec3(1.4,1.15,.7), smoothstep(.35,1.4,lum)) * (.35+lum*.9), uTint*.85);
        c *= mix(1., smoothstep(.95,.25,length(d)), .3);
        gl_FragColor = vec4(c,1.);
      }`,
  });
  composer.addPass(lensPass);
  composer.addPass(new OutputPass());
  // Grain goes on after the output transform: added in linear light it is clipped at zero
  // and lifts every dark colour toward brown.
  const grainPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 } },
    vertexShader: PASS_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime,uGrain; varying vec2 vUv;
      float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){
        vec4 c = texture2D(tDiffuse,vUv);
        c.rgb += (h(vUv*1000.+fract(uTime)*37.)-.5)*uGrain;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grainPass);

  /* ---------------- layout ---------------- */
  let textW = 10;
  const TEXT_ASPECT = 4;
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    barU.uRes.value.set(w * PR, h * PR);
    textW = Math.min(visW(10) * 0.92, 16);
    text.scale.set(textW, textW / TEXT_ASPECT, 1);
  };
  resize();

  /* ---------------- the mosaic follows the card in the centre ---------------- */
  let mosaicIdx = 0;
  let mosaicT = 1;
  const showCard = (i: number) => {
    if (i === mosaicIdx) return;
    mosaicIdx = i;
    wallU.uImgA.value = wallU.uImgB.value;
    wallU.uImgB.value = cardTex[i];
    mosaicT = 0;
  };

  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler();

  const render: PrismScene["render"] = (c, s, vel, mouse, dt) => {
    uTime.value += dt;
    const t = uTime.value;

    camera.position.set(mouse.x * 0.25, mouse.y * 0.15, state.camZ);
    camera.lookAt(0, 0, 0);

    /* the wall */
    wallU.uForest.value = clamp(c.wallForest);
    wallU.uMosaic.value = c.wallMosaic;
    wallU.uIvory.value = c.wallIvory;
    wallU.uDeep.value = c.wallDeep;
    backMat.color.setRGB(0.77 * c.wallIvory, 0.72 * c.wallIvory, 0.64 * c.wallIvory);
    mosaicT = Math.min(1, mosaicT + dt / 0.7);
    wallU.uImgMix.value = eOut(mosaicT);
    wall.rotation.y = s * 0.22 + mouse.x * 0.03 + t * 0.004;
    const ink = 1 - c.wallIvory;
    gridU.uCol.value.setRGB(lerp(0.12, 0.96, ink), lerp(0.2, 0.94, ink), lerp(0.16, 0.9, ink));
    gridU.uLineA.value = lerp(0.1, 0.09, c.wallIvory);
    gridU.uPlusA.value = lerp(0.6, 0.4, c.wallIvory);

    /* the words */
    textU.uMix.value = c.wordMix;
    textU.uGray.value = c.wordGray;
    text.position.z = -3.2 * c.wordBack;
    const tf = (10 - text.position.z) / 10;
    text.scale.set(textW * tf, (textW / TEXT_ASPECT) * tf, 1);
    textU.uOut.value = c.wordOut;
    text.visible = c.wordOut < 1;

    /* the prism: beside the sentence at first, then wandering between the cards */
    const vw = visW(10);
    const kW = c.prismRoam;
    // Over the cards it circles the one in the centre: beside it — left, then right — while the
    // card rests, over or under it while the cards change. It never sits on the price.
    const orbit = Math.PI * c.cardLin + Math.PI / 2;
    const px = lerp(0.23 * vw, Math.sin(orbit) * vw * 0.37, kW);
    const py = lerp(0.42, 0.25 + Math.cos(orbit) * 1.35, kW);
    const pz = lerp(1.7, 2.8, kW);
    let ps = lerp(0.6, 0.5, kW) * (1 - c.prismGone);
    if (vw < 7) ps *= 0.7;
    prism.position.set(px, py + c.prismGone * 2, pz);
    prism.scale.setScalar(Math.max(ps, 1e-4));
    prism.visible = ps > 0.002;
    e3.set(0.12 + Math.sin(t * 0.37) * 0.12 - mouse.y * 0.35, -0.3 + Math.sin(t * 0.42) * 0.35 + mouse.x * 0.55 + s * 1.4, -0.12 + Math.sin(t * 0.29) * 0.08);
    q.setFromEuler(e3);
    prism.quaternion.slerp(q, 0.08);

    /* the cards */
    const a = c.card;
    panels.forEach((p, i) => {
      const x = (i - a) * 6.2 * Math.min(1, vw / 11);
      const dist = Math.abs(i - a);
      p.visible = c.cardsOn && dist < 2.2;
      p.position.set(x, 0.25, -Math.pow(Math.abs(x), 1.5) * 0.12);
      p.rotation.y = -x * 0.085;
      p.scale.setScalar(lerp(0.78, 1, 1 - clamp(dist)) * Math.min(1, vw / 9));
      const u = (p.material as THREE.ShaderMaterial).uniforms;
      u.uReveal.value = 1 - smooth(range(dist, 0.9, 1.9));
      u.uActive.value = 1 - clamp(dist * 1.4);
      u.uVel.value = vel;
      u.uBend.value = 0.6 + Math.abs(vel) * 0.8;
    });
    if (c.caption > 0) showCard(clamp(Math.round(a), 0, panels.length - 1));

    /* the rules */
    rulesWord.visible = c.rulesOn > 0.001;
    rulesU.uWarp.value = c.rulesWarp + Math.abs(vel) * 0.15;
    // The word of the rule being read is the one in front; it drifts a little, never away.
    {
      const i = Math.floor(c.ruleAt);
      const a = ruleCenters[i] ?? 0;
      let b = ruleCenters[Math.min(i + 1, ruleCenters.length - 1)] ?? a;
      if (b < a) b += 1;
      rulesU.uOff.value = lerp(a, b, c.ruleAt - i) + RULES_FRONT + Math.sin(t * 0.25) * 0.004 - (1 - c.rulesOn) * 0.12;
    }
    rulesU.uOp.value = c.rulesOn;
    rulesU.uLum.value = lerp(1, 0.34, c.rulesDim);

    /* the bar */
    barU.uLen.value = c.barLen;
    barU.uWid.value = c.barWid;
    barU.uAlpha.value = c.barAlpha;
    bar.visible = c.barAlpha > 0.001;

    /* the mark lands */
    const fIn = c.markIn;
    mark.visible = fIn > 0;
    const mk = (Math.min(vw, 13) * 0.4) / 220;
    mark.position.set(vw * 0.2, lerp(-5.5, 0.35, eBack(fIn)), 0.5);
    mark.rotation.set(lerp(-0.6, 0, eOut(fIn)), lerp(0.9, -0.12 + mouse.x * 0.12, eOut(fIn)), 0);
    mark.scale.setScalar(mk);

    /* post */
    const burst = fIn * (1 - fIn) * 4;
    lensPass.uniforms.uCA.value = state.ca + Math.abs(vel) * 0.012 + c.rulesWarp * c.rulesOn * 0.006 + burst * 0.03;
    lensPass.uniforms.uTint.value = state.tint;
    grainPass.uniforms.uTime.value = t;
    // on ivory the bloom would wash the paper out; it is for the dark acts
    // …and the rules' letters are large enough to flood the screen with it
    bloom.strength = (state.bloom * (1 - c.rulesOn * 0.55) + burst * 0.4) * (1 - c.wallIvory * 0.85);
    composer.render();
  };

  const setContent = (next: SceneContent) => {
    content = next;
    const old = [sentenceTex, wordTex, rulesTex, ...cardTex];
    makeTextures();
    textU.uA.value = sentenceTex;
    textU.uB.value = wordTex;
    rulesU.uTex.value = rulesTex;
    panels.forEach((p, i) => ((p.material as THREE.ShaderMaterial).uniforms.uMap.value = cardTex[i]));
    wallU.uImgA.value = cardTex[mosaicIdx];
    wallU.uImgB.value = cardTex[mosaicIdx];
    old.forEach((tex) => tex.dispose());
  };

  const dispose = () => {
    [sentenceTex, wordTex, rulesTex, ...cardTex].forEach((tex) => tex.dispose());
    disposables.forEach((d) => d.dispose());
    composer.dispose();
    renderer.dispose();
  };

  return { state, render, resize, setContent, dispose };
}
