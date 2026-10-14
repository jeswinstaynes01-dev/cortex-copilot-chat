/**
 * ambient.ts — decides how much decorative motion this machine can afford.
 *
 * WHY THIS EXISTS
 *
 * Cortex has eleven infinite animations: two drifting cloud layers, a grain
 * wash, a shimmering gradient on the greeting, and seven separate layers of
 * motion on the orb. On a laptop with a GPU that is free — the compositor
 * hands those layers to hardware and the main thread never sees them.
 *
 * This machine has no GPU. `Win32_VideoController` reports two synthetic
 * Microsoft adapters (Hyper-V Video, Remote Display Adapter) with no video
 * memory, so Chrome falls back to SwiftShader and paints **every pixel on the
 * CPU**. The display is a remote adapter locked to 32Hz, which means each of
 * those painted frames is then video-encoded and sent over a network.
 *
 * Under that cost model the arithmetic inverts. `.orb__body` animates an
 * eight-value `border-radius` across a 21,000px² area carrying a seven-stop
 * gradient and three box-shadows. Measured on a GPU that costs about one
 * frame per second, which is why it was dismissed during the first
 * performance pass. Re-rasterised on a CPU thirty times a second, forever, it
 * is one of the most expensive things on the page — and it is competing for
 * that CPU with the hover state the user is waiting for.
 *
 * So motion is not switched on because it looks good; it is switched on when
 * there is capacity for it. Two independent mechanisms:
 *
 *   html[data-busy]        set while the user is actively doing something.
 *                          Ambient motion yields to interaction on EVERY
 *                          machine, because nobody studies drifting clouds
 *                          while aiming at a button.
 *
 *   html[data-perf="low"]  set when this device cannot sustain a smooth frame
 *                          rate at all. Ambient motion stops for good; only
 *                          interaction feedback survives.
 *
 * Neither touches React state. These are attributes on <html>, toggled only on
 * a genuine change. Routing `pointermove` through `useState` would re-render
 * the entire tree dozens of times a second and cost far more than the
 * animations ever did.
 */

/* ------------------------------------------------------------------------
   1. Yielding to interaction
   ------------------------------------------------------------------------ */

/** Quiet period before ambient motion returns. Long enough to survive the gap
 *  between two deliberate clicks, short enough that the page feels alive again
 *  the moment you sit back. */
const RESUME_AFTER_MS = 900;

/** Events that mean "a person is doing something right now". `scroll` and
 *  `wheel` are included because a moving list repaints on its own and should
 *  not have to share the budget with decoration. */
const ACTIVITY = ["pointermove", "pointerdown", "wheel", "scroll", "keydown"] as const;

export function watchActivity(): () => void {
  const root = document.documentElement;
  let busy = false;
  let timer = 0;

  const setBusy = (next: boolean) => {
    // Only touch the DOM on a real transition. `pointermove` fires dozens of
    // times a second and an unconditional write invalidates styles every time.
    if (busy === next) return;
    busy = next;
    if (next) root.setAttribute("data-busy", "");
    else root.removeAttribute("data-busy");
  };

  const onActivity = () => {
    setBusy(true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setBusy(false), RESUME_AFTER_MS);
  };

  // `passive` promises we will never call preventDefault, so scrolling does not
  // wait on this handler. `capture` sees events even if a child stops them.
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of ACTIVITY) window.addEventListener(type, onActivity, opts);

  /* A hidden tab still runs animations in some engines, and a tab paused with
     no resume event pending would stay frozen on return. Reset on both. */
  const onVisibility = () => {
    window.clearTimeout(timer);
    setBusy(document.visibilityState === "hidden");
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.clearTimeout(timer);
    for (const type of ACTIVITY) window.removeEventListener(type, onActivity, opts);
    document.removeEventListener("visibilitychange", onVisibility);
    root.removeAttribute("data-busy");
  };
}

/* ------------------------------------------------------------------------
   2. Deciding whether this machine can afford motion at all
   ------------------------------------------------------------------------ */

/** Below this, ambient motion is doing more harm than good.
 *
 *  A 60Hz machine keeping up measures ~58. This VM measures ~32, limited by the
 *  remote display rather than by the page. Both a slow display and a struggling
 *  renderer land under 45, and the right response to either is the same: stop
 *  spending frames on decoration. */
const SMOOTH_ENOUGH_FPS = 45;

/** How long each sample counts frames for. Short, because several are taken. */
const SAMPLE_MS = 700;

/** How many samples, and how long to wait between them. */
const SAMPLES = 3;
const GAP_MS = 400;

/** Delay before the first sample, so mount, first paint and the entry
 *  animations are finished. Measuring during startup would condemn every
 *  machine to low. */
const SETTLE_MS = 1400;

/** Names Chrome reports when there is no hardware behind it. SwiftShader is
 *  Chrome's own CPU rasteriser; llvmpipe is the Mesa equivalent on Linux;
 *  "Basic Render" is the Windows fallback adapter. */
const SOFTWARE_RENDERERS = ["swiftshader", "llvmpipe", "basic render", "software"];

/** Asks Chrome what is actually drawing. This is a hint, not the verdict — the
 *  frame count below is authoritative — but it is available immediately, so a
 *  machine with no GPU gets relief on the first frame instead of after a
 *  couple of seconds of heavy animation. */
function usesSoftwareRendering(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    if (!gl) return true; // No WebGL at all is itself a bad sign.
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return false;
    const name = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    return SOFTWARE_RENDERERS.some((s) => name.includes(s));
  } catch {
    // A blocked or unavailable WebGL context tells us nothing either way, and
    // guessing "slow" here would punish a locked-down but perfectly fast
    // machine. Let the measurement decide.
    return false;
  }
}

/** Counts real frames over `SAMPLE_MS`. `requestAnimationFrame` only fires when
 *  the browser actually produces a frame, so this measures delivered frames
 *  rather than elapsed time — which is exactly the thing the user perceives. */
function sampleFps(): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    const tick = () => {
      frames++;
      const elapsed = performance.now() - started;
      if (elapsed < SAMPLE_MS) requestAnimationFrame(tick);
      else resolve(Math.round((frames * 1000) / elapsed));
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Takes several samples and keeps the BEST one.
 *
 * The question being asked is "what is this machine capable of", not "what did
 * it manage during the second I happened to look". Those differ: a capable
 * machine that was loading data, decoding an image or streaming a reply during
 * the sample reports a low number once and sixty the rest of the time, and
 * acting on the unlucky sample would strip its animations permanently for no
 * reason. Taking the maximum makes a false "low" require every sample to be
 * slow, while a genuinely capped display — this VM cannot exceed 32Hz no
 * matter what else is happening — can never produce a fast one.
 *
 * Biasing optimistic is also the safer direction to be wrong in. Wrongly
 * staying rich costs some frames on a slow machine; wrongly dropping to low
 * silently removes work the user asked for, which is the harder error to
 * notice and the more annoying one to live with.
 */
async function measureCapability(): Promise<number> {
  let best = 0;
  for (let i = 0; i < SAMPLES; i++) {
    // A hidden tab throttles rAF to about one frame a second. That is not a
    // measurement of anything, so it is skipped rather than averaged in.
    if (document.visibilityState !== "visible") {
      await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }
    best = Math.max(best, await sampleFps());
    // No point continuing once the machine has proved it can keep up.
    if (best >= SMOOTH_ENOUGH_FPS) break;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return best;
}

export function detectPerfMode(): () => void {
  const root = document.documentElement;
  let cancelled = false;

  /* Provisional verdict, applied now. If there is no GPU the answer is not
     going to improve, and waiting two seconds to admit it means two seconds of
     exactly the motion we are about to turn off. */
  if (usesSoftwareRendering()) root.setAttribute("data-perf", "low");

  const timer = window.setTimeout(async () => {
    const fps = await measureCapability();
    if (cancelled || fps === 0) return;

    /* The measurement is final, and it can overturn the renderer hint in both
       directions: a software rasteriser that keeps up comfortably is allowed
       its animations back, and a machine with a GPU that still cannot hold a
       frame rate loses them. Measuring the outcome beats assuming from the
       hardware. */
    if (fps < SMOOTH_ENOUGH_FPS) root.setAttribute("data-perf", "low");
    else root.removeAttribute("data-perf");

    root.setAttribute("data-fps", String(fps));
  }, SETTLE_MS);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
