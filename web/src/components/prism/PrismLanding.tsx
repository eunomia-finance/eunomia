// The landing page. On a screen that can carry it, the moving version (PrismStage: a WebGL
// scene driven by the scroll). Everywhere else — a phone, a browser without WebGL 2, a reader
// who asked for reduced motion — the same words as a still page (PrismStatic).
//
// The scene and three.js are a separate chunk: the still page, and the app behind the door,
// never download them.
import { Suspense, lazy, useEffect, useState } from "react";
import PrismStatic from "./PrismStatic";

const PrismStage = lazy(() => import("./PrismStage"));

/** Wide enough for the fixed layers, a pointer that hovers, WebGL 2, and motion not declined. */
function canStage(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.innerWidth < 980 || window.innerHeight < 620) return false;
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export default function PrismLanding({ onEnter }: { onEnter: () => void }) {
  const [stage, setStage] = useState(canStage);

  // A window dragged narrow falls back to the still page; dragged wide again, it comes back.
  useEffect(() => {
    const onResize = () => setStage(canStage());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!stage) return <PrismStatic onEnter={onEnter} />;
  return (
    <Suspense fallback={<div className="pz-boot" />}>
      <PrismStage onEnter={onEnter} />
    </Suspense>
  );
}
