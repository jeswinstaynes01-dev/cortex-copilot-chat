/**
 * perf.mjs — measures whether the UI is actually smooth, rather than whether it
 * looks smooth in a screenshot.
 *
 * Three numbers matter, and they answer three different questions:
 *
 *   idle fps        Is the page burning frames when nobody is touching it?
 *                   An interface at rest should cost nothing. If this is low,
 *                   some always-on animation is repainting every frame, and
 *                   every interaction will then queue behind it.
 *
 *   hover latency   How long between the pointer arriving and the element
 *                   actually starting to change? This is the number the user
 *                   feels as "late". Anything over ~50ms reads as broken.
 *
 *   long tasks      Main-thread blocks over 50ms. Each one is a window during
 *                   which the browser cannot respond to input at all.
 *
 * Run with the dev server up:  node perf.mjs
 * CHROME_PATH overrides the browser binary (e.g. /usr/bin/google-chrome on Linux).
 */
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.CORTEX_URL ?? "http://localhost:5174/?mock";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(URL, { waitUntil: "domcontentloaded" });
// Let the entry animations finish; measuring during them is measuring the wrong thing.
await page.waitForTimeout(2500);

/* ---- 1. Idle frame rate -------------------------------------------------
   requestAnimationFrame fires once per presented frame, so counting calls
   over a fixed window gives the real presented rate. Nothing is interacting
   with the page here — this is the cost of simply existing. */
const idle = await page.evaluate(async () => {
  let frames = 0;
  const start = performance.now();
  await new Promise((done) => {
    const tick = () => {
      frames++;
      if (performance.now() - start < 2000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  return Math.round((frames / (performance.now() - start)) * 1000);
});

/* ---- 2. Long tasks ------------------------------------------------------
   A "long task" is any uninterrupted main-thread block over 50ms. The browser
   cannot dispatch a single input event while one is running. */
const longTasks = await page.evaluate(async () => {
  const seen = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) seen.push(Math.round(e.duration));
  });
  try {
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    return { supported: false, tasks: [] };
  }
  await new Promise((r) => setTimeout(r, 3000));
  obs.disconnect();
  return { supported: true, tasks: seen };
});

/* ---- 3. Hover latency ---------------------------------------------------
   CSS `:hover` only responds to a real pointer, so this drives the actual
   mouse rather than dispatching synthetic events (which never match `:hover`
   and would make every element look broken).

   The watcher starts polling BEFORE the mouse moves, so the clock includes
   the part the user actually feels: the time the main thread spends too busy
   to notice the pointer arrived.

   That raw number is NOT the app's response time, though. Driving the mouse
   happens over CDP from Node, and `{steps: 4}` means four separate round
   trips before the pointer even lands on the target — about 55ms on this
   machine, none of it the app's fault. `cdpFloor()` below measures exactly
   that overhead so it can be subtracted. Reporting the raw figure once led
   this project to keep optimising something that was already a single frame
   away from optimal. */

/* The overhead floor: how long the mouse takes to ARRIVE, measured the same
   way the hover test measures it.

   The subtlety: an element only matches `:hover` on the final step of the
   move. Watching for the *first* pointermove therefore reports a quarter of
   the true overhead, which is a flattering and completely wrong number. This
   waits for the event whose coordinates match the destination. */
async function cdpFloor() {
  const X = 700;
  const Y = 400;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(220);
  await page.evaluate(
    ([x, y]) => {
      window.__floor = null;
      const t0 = performance.now();
      const on = (e) => {
        if (Math.abs(e.clientX - x) < 2 && Math.abs(e.clientY - y) < 2) {
          window.__floor = Math.round(performance.now() - t0);
          window.removeEventListener("pointermove", on);
        }
      };
      window.addEventListener("pointermove", on);
    },
    [X, Y],
  );
  await page.mouse.move(X, Y, { steps: 4 });
  await page.waitForFunction(() => window.__floor !== null, null, { timeout: 3000 });
  return page.evaluate(() => window.__floor);
}

async function hoverLatency(selector, prop) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;

  const box = await el.boundingBox();
  if (!box) return null;

  /* A disabled control carries `pointer-events: none`, so it genuinely cannot
     hover. Without this check the probe reports "never changed", which looks
     identical to a broken hover state and sends you hunting for a bug that
     does not exist. */
  const inert = await el.evaluate(
    (n) => n.disabled === true || getComputedStyle(n).pointerEvents === "none",
  );
  if (inert) return "disabled";

  // Park the mouse somewhere neutral so we always measure a fresh enter.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(220);

  await page.evaluate(
    ([sel, property]) => {
      const node = document.querySelector(sel);
      window.__hoverResult = null;
      const before = getComputedStyle(node)[property];
      const t0 = performance.now();
      const check = () => {
        if (window.__hoverResult !== null) return;
        if (getComputedStyle(node)[property] !== before) {
          window.__hoverResult = Math.round(performance.now() - t0);
        } else if (performance.now() - t0 > 900) {
          window.__hoverResult = -1;
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    },
    [selector, prop],
  );

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForFunction(() => window.__hoverResult !== null, null, { timeout: 3000 });
  return page.evaluate(() => window.__hoverResult);
}

const floor = await cdpFloor();

const hovers = {};
for (const [name, sel, prop] of [
  ["sidebar history row", ".history__row", "backgroundColor"],
  // `.rail__new` is a `.btn--dark`, whose hover changes background, not
  // transform. Probing the wrong property reports "NO CHANGE" and looks like
  // a broken button.
  ["new chat button", ".rail__new", "backgroundColor"],
  ["suggestion card", ".card", "transform"],
  // Must be the bordered variant: the other `.iconbtn`s on this screen are the
  // mobile menu and drawer-close buttons, which are `display: none` at desktop
  // width and so have no box to aim at.
  ["icon button", ".iconbtn--bordered", "borderColor"],
]) {
  const raw = await hoverLatency(sel, prop);
  // -1 means the style never changed and "disabled" means it could not be
  // hovered at all; leave both signals intact rather than turning them into
  // nonsensical numbers.
  hovers[name] =
    raw === null || raw === -1 || typeof raw === "string" ? raw : Math.max(0, raw - floor);
  await page.waitForTimeout(250);
}

/* ---- 3b. Frames per second while the pointer is moving ------------------
   The single most representative number in this file. Idle fps measures the
   screensaver; this measures the app under the user's hand, which is the only
   time anyone notices a dropped frame. */
const movingFps = await (async () => {
  const pending = page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
          else res(Math.round((n / (performance.now() - t0)) * 1000));
        };
        requestAnimationFrame(tick);
      }),
  );
  for (let i = 0; i < 50; i++) {
    await page.mouse.move(400 + (i % 40) * 12, 300 + (i % 20) * 9);
    await page.waitForTimeout(45);
  }
  return pending;
})();

/* ---- 4. What is actually repainting ------------------------------------
   Counts how many elements carry a continuously running animation, and flags
   the ones animating properties that force paint rather than compositing. */
const animations = await page.evaluate(() => {
  // Properties the compositor can handle alone. Anything else means the
  // browser must repaint the element on every single frame.
  const CHEAP = new Set(["transform", "opacity", "translate", "scale", "rotate"]);
  const out = [];
  for (const a of document.getAnimations()) {
    const name = a.animationName ?? "(transition)";
    const el = a.effect?.target;
    if (!el) continue;
    const infinite = a.effect?.getTiming?.().iterations === Infinity;
    if (!infinite) continue;

    let props = [];
    try {
      const frames = a.effect.getKeyframes();
      props = [...new Set(frames.flatMap((f) => Object.keys(f)))].filter(
        (k) => !["offset", "computedOffset", "easing", "composite"].includes(k),
      );
    } catch {
      /* some animations refuse to enumerate; name alone is enough to spot them */
    }
    const expensive = props.filter((p) => !CHEAP.has(p));
    const box = el.getBoundingClientRect();
    out.push({
      name,
      selector: el.className?.toString?.().split(" ")[0] ?? el.tagName,
      props,
      expensive,
      areaPx: Math.round(box.width * box.height),
    });
  }
  return out;
});

const costly = animations.filter((a) => a.expensive.length > 0);

console.log("\n==================== PERF ====================");
console.log(
  `fps while moving  ${movingFps}   ${movingFps >= 55 ? "ok" : "LOW — janky under the hand"}`,
);
console.log(
  `idle fps          ${idle}   ${idle >= 55 ? "ok" : "background animation running (by design)"}`,
);
console.log(
  `long tasks        ${longTasks.supported ? longTasks.tasks.length : "n/a"}` +
    (longTasks.tasks?.length ? `  ${JSON.stringify(longTasks.tasks)}ms` : ""),
);
console.log(`\nhover latency (ms, harness floor of ${floor}ms already subtracted)`);
console.log("  -1 = style never changed, null = element not on screen");
for (const [k, v] of Object.entries(hovers)) {
  const verdict =
    v === null
      ? "not on screen"
      : v === "disabled"
        ? "disabled, cannot hover"
        : v < 0
          ? "NO CHANGE"
          : v <= 50
            ? "ok"
            : "SLOW";
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(8)}  ${verdict}`);
}
console.log(`\ninfinite animations: ${animations.length} (${costly.length} forcing paint)`);
for (const a of costly) {
  console.log(
    `  ${a.name.padEnd(18)} .${String(a.selector).padEnd(16)} ` +
      `${a.areaPx.toString().padStart(8)}px²  ${a.expensive.join(", ")}`,
  );
}
console.log("==============================================\n");

await browser.close();
