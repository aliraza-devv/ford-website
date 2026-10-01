// Renders a car to a picture, from the camera the road finder's scenery is painted with,
// in light that matches the place it will stand in. Run through scripts/bake-cars.mjs.
//
// The world's camera (see src/components/find/panorama.ts): a 1.8 stage-height lens, 1.15 m
// above the road, the car 12.5 m away, the horizon through the middle of the picture. A
// picture is rendered at DENSITY x the 1080-px reference, then cropped to the car.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const REF_H = 1080;
const DENSITY = 1.5;
const FOCAL = 1.8 * REF_H; // px at the reference
const CAMERA_HEIGHT = 1.15;
const CAMERA_DISTANCE = 12.5;
const FRAME_W = 2600; // reference px: wide enough for any car at the angle we shoot
const FRAME_H = REF_H;

const log = (...a) => console.log("[bake]", ...a);

// ---------------------------------------------------------------- environment

/** A dusk sky to reflect: dark overhead, a bright band at the horizon, soft boxes. */
function makeEnvironment(renderer, spec) {
  const scene = new THREE.Scene();
  const dome = new THREE.SphereGeometry(80, 64, 32);
  const colors = [];
  const top = new THREE.Color(spec.sky.top);
  const mid = new THREE.Color(spec.sky.mid);
  const horizon = new THREE.Color(spec.sky.horizon);
  const ground = new THREE.Color(spec.sky.ground);
  const p = dome.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 80;
    if (t >= 0) {
      const a = Math.pow(1 - Math.min(t * 1.6, 1), 2.2);
      c.copy(top).lerp(mid, Math.min(t * 2.2, 1)).lerp(horizon, a);
    } else {
      c.copy(horizon).multiplyScalar(0.18).lerp(ground, Math.min(-t * 6, 1));
    }
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // The afterglow itself, a long bright band low behind the car, and the strips of light that
  // draw the highlights along a body's shoulders and hood.
  for (const b of [...(spec.sky.bands ?? []), ...(spec.sky.strips ?? [])]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(b.w, b.h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color).multiplyScalar(b.power), side: THREE.DoubleSide }),
    );
    m.position.set(...b.at);
    m.lookAt(0, b.at[1], 0);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.015).texture;
  pmrem.dispose();
  return env;
}

// -------------------------------------------------------------------- the car

async function loadCar(spec) {
  const gltf = await new GLTFLoader().loadAsync(spec.glb);
  const car = gltf.scene;
  // The model faces +Z, in units of about 1.08 m. Stand it on the ground, facing +X.
  const bbox = new THREE.Box3().setFromObject(car);
  const len = bbox.max.z - bbox.min.z;
  const k = spec.length / len;
  car.scale.setScalar(k);
  const holder = new THREE.Group();
  holder.add(car);
  holder.rotation.y = Math.PI / 2;
  return { object: holder, glb: car };
}

function restyleGlb(car, spec) {
  car.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      let nm = m;
      if (m.name === "carpaint") {
        nm = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(spec.paint.color),
          metalness: spec.paint.metalness ?? 0.55,
          roughness: spec.paint.roughness ?? 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: spec.paint.env ?? 1.4,
        });
      } else if (m.name === "light") {
        nm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(spec.lamps ?? "#fff1d6"), emissiveIntensity: 2.2, roughness: 0.2 });
      } else if (m.name === "rearlight") {
        nm = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: new THREE.Color("#ff2a1a"), emissiveIntensity: 1.4, roughness: 0.3 });
      } else if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        m.envMapIntensity = spec.env ?? 1;
      }
      if (nm !== m) {
        nm.name = m.name;
        if (Array.isArray(o.material)) o.material[i] = nm;
        else o.material = nm;
      }
    });
  });
}

/** The lights of a place: a low sun behind the car, a cool fill from the front, and a sky. */
function addLights(scene, spec, scale = 1) {
  const lights = [];
  for (const L of spec.lights ?? []) {
    const light = new THREE.DirectionalLight(new THREE.Color(L.color), L.power * scale);
    light.position.set(...L.at);
    light.userData.warm = light.color.r > light.color.b * 1.3;
    scene.add(light);
    lights.push(light);
  }
  const hemi = new THREE.HemisphereLight(new THREE.Color(spec.hemi?.sky ?? "#5b6fa8"), new THREE.Color(spec.hemi?.ground ?? "#06070d"), (spec.hemi?.power ?? 0.35) * scale);
  scene.add(hemi);
  lights.push(hemi);
  return lights;
}

// ----------------------------------------------------------------------- bake

async function bake(spec) {
  const w = Math.round(FRAME_W * DENSITY);
  const h = Math.round(FRAME_H * DENSITY);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = spec.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer, spec);
  scene.environmentIntensity = spec.envIntensity ?? 1;

  const { object, glb } = await loadCar(spec);
  if (glb) restyleGlb(glb, spec);
  const holder = new THREE.Group();
  holder.add(object);
  scene.add(holder);

  // Stand on the ground, centred, facing the way the spec says (yaw of the nose toward the camera).
  holder.rotation.y = -THREE.MathUtils.degToRad(spec.yaw);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  holder.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.updateMatrixWorld(true);
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // At dusk the light is the sky's and there is no hard shadow: the road painter lays a soft
  // one under the car. A spec can still ask for a cast shadow.
  if (spec.shadow) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: spec.shadow }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  addLights(scene, spec);

  // The camera: the world's.
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(REF_H / 2 / FOCAL));
  const camera = new THREE.PerspectiveCamera(fov, FRAME_W / FRAME_H, 0.5, 400);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
  camera.lookAt(0, CAMERA_HEIGHT, 0);

  renderer.render(scene, camera);

  // ---- crop to the car
  const src = renderer.domElement;
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  pctx.drawImage(src, 0, 0);
  const data = pctx.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d").drawImage(probe, x0, y0, cw, ch, 0, 0, cw, ch);

  const horizon = h / 2 - y0; // the camera looks at the horizon: the picture's middle row
  const centre = (w / 2 - x0) / cw;
  const meta = {
    width: cw,
    height: ch,
    // the car's own width in the picture (the picture is cropped to it, less the padding)
    span: cw - 2 * pad,
    density: DENSITY,
    horizon: Math.round(horizon),
    // the lowest row of the car is where its tyres touch, to within the crop's padding
    contact: Math.round(ch - 1 - pad),
    centre: +centre.toFixed(4),
  };
  const dataUrl = out.toDataURL(spec.format ?? "image/webp", 0.94);
  renderer.dispose();
  return { dataUrl, meta };
}

// ------------------------------------------------------------- the loader's car

/**
 * The car in pure profile, for the loader, in three pictures from one orthographic camera: the
 * whole car (which gives the reflection on the road), the car without its wheels (which stay
 * still), and one wheel on its own (which the page spins). The wheels are nodes of the model
 * (GT500Wheel{Ft,Bk}{L,R}_*), so they come away cleanly; the brake discs and calipers are not
 * among them, and show through the spokes as they do on a real car.
 */
async function bakeProfile(spec) {
  const PPM = spec.pxPerM;
  const yc = spec.frameCentre ?? 0.85; // the height the frame is centred on, m
  const frameW = Math.round((spec.length + 1.4) * PPM);
  const frameH = Math.round(2.3 * PPM);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(frameW, frameH, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = spec.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer, spec);
  scene.environmentIntensity = spec.envIntensity ?? 1;
  const { object, glb } = await loadCar(spec);
  restyleGlb(glb, spec);
  const holder = new THREE.Group();
  holder.add(object);
  scene.add(holder);
  holder.rotation.y = 0;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  holder.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.updateMatrixWorld(true);
  const lights = addLights(scene, spec);

  const camera = new THREE.OrthographicCamera(-frameW / 2 / PPM, frameW / 2 / PPM, frameH / 2 / PPM, -frameH / 2 / PPM, 0.1, 100);
  camera.position.set(0, yc, 30);
  camera.lookAt(0, yc, 0);

  const meshes = [];
  object.traverse((o) => o.isMesh && meshes.push(o));
  const WHEEL = /^GT500Wheel(Ft|Bk)[LR]_/;
  const NEAR_FRONT = /^GT500WheelFtR_/;
  const show = (pred) => meshes.forEach((m) => (m.visible = pred(m)));

  const grab = () => {
    renderer.render(scene, camera);
    const c = document.createElement("canvas");
    c.width = frameW;
    c.height = frameH;
    c.getContext("2d", { willReadFrequently: true }).drawImage(renderer.domElement, 0, 0);
    return c;
  };

  show(() => true);
  const full = grab();
  show((m) => !WHEEL.test(m.name));
  const body = grab();
  // the wheel alone, lit a little flatter: it turns, and a highlight that turned with it would
  // look like a fault
  show((m) => NEAR_FRONT.test(m.name));
  // ...with the spokes a gunmetal rather than black (a black wheel turning on a black car does
  // not show that it turns), and none of the warm afterglow that lights the tyre's edge orange
  meshes.filter((m) => NEAR_FRONT.test(m.name)).forEach((m) => {
    const mat = m.material;
    if (mat.name === "glossblack") {
      mat.color.set("#4b5262");
      mat.metalness = 0.9;
      mat.roughness = 0.3;
      mat.envMapIntensity = 1.6;
    } else if (mat.name === "plate") {
      mat.color.set("#b6bdcc");
      mat.metalness = 1;
      mat.roughness = 0.22;
      mat.envMapIntensity = 1.6;
    }
  });
  lights.forEach((l) => {
    if (l.userData.warm) l.intensity *= 0.1;
    else l.intensity *= 0.8;
  });
  const keep = scene.environmentIntensity;
  scene.environmentIntensity = keep * 0.7;
  const wheel = grab();
  scene.environmentIntensity = keep;

  // ---- where things are, in frame px
  const toPx = (p) => [frameW / 2 + p.x * PPM, frameH / 2 - (p.y - yc) * PPM];
  const boxOf = (pred) => {
    const b = new THREE.Box3();
    meshes.filter((m) => pred(m.name)).forEach((m) => b.expandByObject(m));
    return b;
  };
  const wheelBox = (re) => boxOf((n) => re.test(n));
  const fr = wheelBox(/^GT500WheelFtR_/);
  const bk = wheelBox(/^GT500WheelBkR_/);
  const head = boxOf((n) => /^GT500Headlight[LR]_/.test(n));
  const tail = boxOf((n) => /^GT500Taillight[LR]_/.test(n));
  const centre = (b) => toPx(b.getCenter(new THREE.Vector3()));

  // ---- the crop: the whole car, from the full picture
  const probe = full.getContext("2d").getImageData(0, 0, frameW, frameH).data;
  let x0 = frameW, x1 = 0, y0 = frameH, y1 = 0;
  for (let y = 0; y < frameH; y++) for (let x = 0; x < frameW; x++) if (probe[(y * frameW + x) * 4 + 3] > 24) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(frameW - 1, x1 + pad);
  y1 = Math.min(frameH - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropOf = (src) => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    c.getContext("2d").drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);
    return c.toDataURL("image/png");
  };

  // ---- the wheel's own picture: a square round the near front wheel
  const [wx, wy] = centre(fr);
  const D = (fr.max.y - fr.min.y) * PPM;
  const side = Math.ceil(D + 10);
  const wc = document.createElement("canvas");
  wc.width = side;
  wc.height = side;
  wc.getContext("2d").drawImage(wheel, Math.round(wx - side / 2), Math.round(wy - side / 2), side, side, 0, 0, side, side);

  const rel = ([x, y]) => [x - x0, y - y0];
  const [fx, fy] = rel(centre(fr));
  const [bx, by] = rel(centre(bk));
  const [hx, hy] = rel(centre(head));
  const [tx, ty] = rel(centre(tail));
  const [noseX] = rel(toPx(new THREE.Vector3(head.max.x, 0, 0)));
  const [tailX] = rel(toPx(new THREE.Vector3(tail.min.x, 0, 0)));
  const ground = frameH / 2 + yc * PPM - y0; // the row the tyres touch
  renderer.dispose();
  return {
    full: cropOf(full),
    body: cropOf(body),
    wheel: wc.toDataURL("image/png"),
    meta: {
      width: cw,
      height: ch,
      ground: Math.round(ground),
      span: Math.round((x1 - pad) - (x0 + pad)),
      pxPerM: PPM,
      wheelSide: side,
      wheelDiameter: Math.round(D),
      front: [Math.round(fx), Math.round(fy)],
      rear: [Math.round(bx), Math.round(by)],
      headlamp: [Math.round(hx), Math.round(hy)],
      nose: Math.round(noseX),
      taillamp: [Math.round(tx), Math.round(ty)],
      tail: Math.round(tailX),
    },
  };
}

window.bake = bake;
window.bakeProfile = bakeProfile;
window.bakeReady = true;
log("ready");
