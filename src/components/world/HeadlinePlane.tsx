"use client";

/* eslint-disable react-hooks/immutability --
 * useFrame repositions the plane and updates material state every frame. */

import { type RefObject, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import * as THREE from "three";
import type { ParallaxState } from "@/hooks/useParallax";
import { HERO_COPY } from "@/lib/theme";
import {
  HEADLINE_CHAR_SECONDS as CHAR_DURATION,
  HEADLINE_INTRO_SECONDS,
  HEADLINE_STAGGER_SECONDS as STAGGER,
  type HeadlineIntro,
} from "@/lib/headlineIntro";

const TEXT = HERO_COPY.headline;
/** `text-white/80` in the old DOM headline. */
const TEXT_OPACITY = 0.8;
/** `tracking-[-0.04em]` and `leading-[0.85]`, straight from Hero.tsx. */
const TRACKING_EM = -0.04;
const LINE_HEIGHT_EM = 0.85;
/** Metres behind the car's centre the headline plane sits: clear of the rear bumper. */
const BEHIND_CAR = 3.2;
/** The old wrapper translated by `--parallax-* * 0.6`; parallax is +-20 / +-12 px. */
const PARALLAX_X_PX = 20 * 0.6;
const PARALLAX_Y_PX = 12 * 0.6;

const easePower3Out = (t: number) => 1 - Math.pow(1 - t, 3);

type Raster = {
  width: number;
  height: number;
  dpr: number;
  family: string;
  weight: string;
  sizePx: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

function drawHeadline(r: Raster, intro: number) {
  const { ctx, dpr, width, height, sizePx } = r;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = `${r.weight} ${sizePx}px ${r.family}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";

  const chars = [...TEXT];
  const tracking = TRACKING_EM * sizePx;

  // Advance per character INCLUDING kerning with its neighbour (measure the
  // pair, subtract the second glyph), so the raster matches the un-split DOM
  // headline's spacing.
  const advance = chars.map((c, i) =>
    i < chars.length - 1
      ? ctx.measureText(c + chars[i + 1]).width - ctx.measureText(chars[i + 1]).width
      : ctx.measureText(c).width,
  );
  const total = advance.reduce((a, b) => a + b, 0) + tracking * chars.length;
  let x = (width - total) / 2; // the old flex container centred the h1 box

  // The h1 box is `leading-[0.85]` tall and sat at the BOTTOM of its
  // wrapper (`items-end`); the baseline inside a line box is offset by half
  // the leading (negative here, since 0.85 < the font's content height).
  const lineH = LINE_HEIGHT_EM * sizePx;
  const m = ctx.measureText("H");
  const baseline = height - lineH + (lineH - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;

  const introSeconds = intro * HEADLINE_INTRO_SECONDS;
  for (let i = 0; i < chars.length; i++) {
    const t = Math.min(Math.max((introSeconds - i * STAGGER) / CHAR_DURATION, 0), 1);
    const e = easePower3Out(t);
    if (e > 0 && chars[i] !== " ") {
      ctx.globalAlpha = e;
      // SplitText's `yPercent: 130` -> 0: each letter rises from below,
      // and the canvas edge clips it exactly as the wrapper's overflow did.
      ctx.fillText(chars[i], x, baseline + (1 - e) * 1.3 * lineH);
    }
    x += advance[i] + tracking;
  }
  ctx.globalAlpha = 1;
}

type HeadlinePlaneProps = {
  parallaxRef: RefObject<ParallaxState>;
  carGroupRef: RefObject<THREE.Group | null>;
  introRef: RefObject<HeadlineIntro>;
};

const camPos = new THREE.Vector3();
const carPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const axis = new THREE.Vector3();

/**
 * "BUILT FORD TOUGH", drawn into the scene instead of the page.
 *
 * It used to be DOM text sitting between the road (behind) and the car
 * canvas (in front). With the world moved into the car's canvas that stacking
 * is gone, so the headline is now a plane in the scene itself: pinned to the
 * same screen rectangle (read from the still-present DOM wrapper, so
 * LAYOUT stays the single source of truth), but placed in DEPTH just behind
 * the car. That gives the order the brief asks for -- world, headline, car
 * -- with real occlusion, including mid-scroll when the dolly-in carries the
 * roofline up into the text.
 *
 * The raster uses the page's own loaded font at the same fitted size,
 * tracking and leading, so it reads identically to the old DOM text.
 */
export function HeadlinePlane({ parallaxRef, carGroupRef, introRef }: HeadlinePlaneProps) {
  const size = useThree((s) => s.size);
  const mesh = useRef<THREE.Mesh>(null);
  const wrapRef = useRef<HTMLElement | null>(null);
  const raster = useRef<Raster | null>(null);
  const lastIntro = useRef(-1);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        // Glyph pixels WRITE depth (and fully transparent ones are discarded
        // by alphaTest, so the empty rectangle around the letters doesn't).
        // Without this the depth-of-field pass reads the far sky BEHIND the
        // text, decides the text is miles out of focus, and blurs it.
        depthWrite: true,
        alphaTest: 0.04,
        fog: false,
        opacity: 0,
      }),
    [],
  );

  useEffect(() => {
    const wrap = document.querySelector<HTMLElement>(".hero-headline-wrap");
    const h1 = wrap?.querySelector<HTMLElement>(".hero-headline");
    if (!wrap || !h1) return;
    wrapRef.current = wrap;

    let cancelled = false;

    async function rebuild() {
      const cs = getComputedStyle(h1!);
      const family = cs.fontFamily;
      const weight = cs.fontWeight;
      const sizePx = parseFloat(cs.fontSize);
      await document.fonts.load(`${weight} ${sizePx}px ${family}`, TEXT);
      if (cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = wrap!.clientWidth;
      const height = wrap!.clientHeight;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext("2d")!;

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      // A new texture every rebuild: WebGL2 texture storage is immutable, so
      // resizing one in place is not allowed.
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;

      raster.current = { width, height, dpr, family, weight, sizePx, canvas, ctx };
      drawHeadline(raster.current, introRef.current.p);
      texture.needsUpdate = true;
      lastIntro.current = introRef.current.p;
    }

    rebuild();
    // The wrapper is resized by the window (and useFitText re-fits the font
    // with it), so its size is the right signal to re-rasterise.
    const observer = new ResizeObserver(() => void rebuild());
    observer.observe(wrap);
    void document.fonts.ready.then(() => rebuild());

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [material, introRef]);

  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );

  useFrame((state) => {
    const plane = mesh.current;
    const wrap = wrapRef.current;
    const r = raster.current;
    if (!plane || !wrap || !r) return;

    // Only the ~1 s intro animates the glyphs; afterwards it is a still image.
    const intro = introRef.current.p;
    if (intro !== lastIntro.current) {
      drawHeadline(r, intro);
      if (material.map) material.map.needsUpdate = true;
      lastIntro.current = intro;
    }

    // The existing scroll timeline still fades/lifts the (invisible) DOM
    // wrapper; it stays the single source of truth for the headline's scroll
    // behaviour, and the plane just follows it.
    const fade = Number(gsap.getProperty(wrap, "opacity"));
    if (!(fade > 0.002)) {
      plane.visible = false;
      return;
    }
    plane.visible = true;
    material.opacity = TEXT_OPACITY * fade;

    const cam = state.camera as THREE.PerspectiveCamera;
    cam.getWorldPosition(camPos);
    cam.getWorldQuaternion(camQuat);
    carGroupRef.current?.getWorldPosition(carPos);

    const distance = camPos.distanceTo(carPos) + BEHIND_CAR;
    const halfH = distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const halfW = halfH * cam.aspect;

    // The wrapper's rectangle in viewport pixels (untransformed layout
    // values) -> normalised device coordinates.
    const dy = Number(gsap.getProperty(wrap, "y")) || 0;
    const { parallaxX, parallaxY } = {
      parallaxX: parallaxRef.current.x * PARALLAX_X_PX,
      parallaxY: parallaxRef.current.y * PARALLAX_Y_PX,
    };
    const ndcX = ((wrap.offsetLeft + wrap.offsetWidth / 2 + parallaxX) / size.width) * 2 - 1;
    const ndcY = 1 - ((wrap.offsetTop + wrap.offsetHeight / 2 + dy + parallaxY) / size.height) * 2;

    plane.position.copy(camPos);
    plane.position.addScaledVector(axis.set(0, 0, -1).applyQuaternion(camQuat), distance);
    plane.position.addScaledVector(axis.set(1, 0, 0).applyQuaternion(camQuat), ndcX * halfW);
    plane.position.addScaledVector(axis.set(0, 1, 0).applyQuaternion(camQuat), ndcY * halfH);
    plane.quaternion.copy(camQuat);
    plane.scale.set((wrap.offsetWidth / size.width) * 2 * halfW, (wrap.offsetHeight / size.height) * 2 * halfH, 1);
  });

  return (
    <mesh ref={mesh} renderOrder={5} frustumCulled={false} visible={false}>
      <planeGeometry args={[1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
