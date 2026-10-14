import { useEffect, useRef } from "react";

/**
 * Mission-control backdrop: a slowly drifting technical grid crossed by a wide
 * radar sweep.
 *
 * Everything is drawn at very low alpha so it reads as texture rather than
 * decoration — the reference design keeps its background almost subliminal. The
 * animation loop is skipped entirely under `prefers-reduced-motion`, which still
 * paints one static frame so the texture does not simply vanish.
 */

const CELL = 48; // grid spacing, CSS pixels
const DRIFT = 4; // vertical grid scroll, px per second
const SWEEP_PERIOD = 16; // seconds per radar revolution
const WEDGE_STEPS = 22; // sub-wedges used to fake a conic gradient trail
const WEDGE_ARC = Math.PI / 2.4; // angular length of the sweep trail

export default function GridField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    const started = performance.now();

    const resize = () => {
      // Cap DPR at 2 — beyond that the cost doubles for texture nobody can see.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawGrid = (offset: number) => {
      ctx.lineWidth = 1;
      ctx.beginPath();
      // The 0.5 offset lands the stroke on a device pixel so lines stay crisp.
      for (let x = 0; x <= width + CELL; x += CELL) {
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = (offset % CELL) - CELL; y <= height + CELL; y += CELL) {
        const py = Math.round(y) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.strokeStyle = "rgba(180, 255, 63, 0.035)";
      ctx.stroke();

      // Every fourth line is brighter, giving the grid a major/minor rhythm.
      ctx.beginPath();
      for (let x = 0; x <= width + CELL * 4; x += CELL * 4) {
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      for (let y = (offset % (CELL * 4)) - CELL * 4; y <= height + CELL * 4; y += CELL * 4) {
        const py = Math.round(y) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
      }
      ctx.strokeStyle = "rgba(180, 255, 63, 0.055)";
      ctx.stroke();
    };

    const drawSweep = (angle: number) => {
      const cx = width * 0.78;
      const cy = height * 0.42;
      const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));

      ctx.save();
      ctx.translate(cx, cy);
      // `lighter` makes overlapping wedges accumulate into a soft leading edge.
      ctx.globalCompositeOperation = "lighter";

      /*
       * One radial gradient shared by every wedge, with per-wedge `globalAlpha`
       * supplying the angular falloff. Without the radial fade the wedges end in
       * a hard straight edge at the canvas corner, which reads as a glitch
       * rather than a sweep.
       */
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, "rgba(180, 255, 63, 0.9)");
      grad.addColorStop(0.5, "rgba(180, 255, 63, 0.3)");
      grad.addColorStop(1, "rgba(180, 255, 63, 0)");
      ctx.fillStyle = grad;

      for (let i = 0; i < WEDGE_STEPS; i += 1) {
        const t = i / WEDGE_STEPS;
        const from = angle - WEDGE_ARC * t;
        // The extra 0.012 overlaps neighbouring wedges so no seams show.
        const to = from - WEDGE_ARC / WEDGE_STEPS - 0.012;

        ctx.globalAlpha = 0.035 * Math.pow(1 - t, 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, to, from);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    };

    const render = (now: number) => {
      const elapsed = (now - started) / 1000;
      ctx.clearRect(0, 0, width, height);
      drawGrid(elapsed * DRIFT);
      drawSweep((elapsed / SWEEP_PERIOD) * Math.PI * 2);
      frame = requestAnimationFrame(render);
    };

    const startLoop = () => {
      cancelAnimationFrame(frame);
      resize();
      if (motion.matches) {
        // Static texture only: grid, no moving sweep.
        ctx.clearRect(0, 0, width, height);
        drawGrid(0);
        return;
      }
      frame = requestAnimationFrame(render);
    };

    const onResize = () => {
      resize();
      if (motion.matches) {
        ctx.clearRect(0, 0, width, height);
        drawGrid(0);
      }
    };

    startLoop();
    window.addEventListener("resize", onResize);
    motion.addEventListener("change", startLoop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      motion.removeEventListener("change", startLoop);
    };
  }, []);

  return <canvas ref={canvasRef} className="gridfield" aria-hidden="true" />;
}
