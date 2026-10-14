/* =============================================================================
   Design Lab — behaviour
   Vanilla ES modules, no dependencies. Every block is commented with what the
   browser API actually does, so this doubles as a reference.
   ========================================================================== */

const root = document.documentElement;
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* -----------------------------------------------------------------------------
   1. Segmented controls

   There is ONE thumb per control. On every change we measure the active button
   and move the thumb to it. Because only `transform` and `width` change, the
   browser can animate it on the compositor — no layout work per frame.
   -------------------------------------------------------------------------- */

function wireSegment(container, { btnSel, thumbSel, onChange }) {
  const thumb = $(thumbSel, container);
  const buttons = $$(btnSel, container);

  function moveTo(btn) {
    // offsetLeft = distance from the button's left edge to its positioned
    // ancestor's left edge, which here is the control itself.
    thumb.style.width = `${btn.offsetWidth}px`;
    thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  function select(btn, fire = true) {
    buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
    moveTo(btn);
    if (fire) onChange?.(btn.dataset.value, btn);
  }

  buttons.forEach((btn) => btn.addEventListener("click", () => select(btn)));

  const active = buttons.find((b) => b.classList.contains("is-active")) ?? buttons[0];
  // Two frames: one for layout, one for the measurement to be correct after
  // fonts settle. Without this the thumb starts at width 0 and visibly jumps.
  requestAnimationFrame(() => requestAnimationFrame(() => select(active, false)));

  // Keep it glued to the button if the rail rewraps on resize.
  new ResizeObserver(() => {
    const current = buttons.find((b) => b.classList.contains("is-active"));
    if (current) moveTo(current);
  }).observe(container);

  return { select };
}

/* -----------------------------------------------------------------------------
   2. Backdrop switching
   -------------------------------------------------------------------------- */

const video = $(".bg__video");
const fileInput = $(".file input");
let objectUrl = null;
let hasVideo = false;

const backdropSeg = wireSegment($('[data-seg="backdrop"]'), {
  btnSel: ".seg__btn",
  thumbSel: ".seg__thumb",
  onChange(value) {
    root.dataset.backdrop = value;
    // Only run the particle loop when it is the layer on screen.
    value === "embers" ? embers.start() : embers.stop();
    if (value === "video") {
      hasVideo ? video.play().catch(() => {}) : fileInput.click();
    } else {
      video.pause();
    }
    readout();
  },
});

wireSegment($('[data-seg="glass"]'), {
  btnSel: ".seg__btn",
  thumbSel: ".seg__thumb",
  onChange(value) {
    root.dataset.glass = value;
    readout();
  },
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  // createObjectURL hands back a temporary in-memory URL for the local file.
  // The old one must be revoked or the browser keeps the whole clip in RAM.
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  hasVideo = true;
  video.play().catch(() => {});
  $(".file span").textContent = file.name.slice(0, 26);
  backdropSeg.select($('[data-seg="backdrop"] [data-value="video"]'));
});

/* -----------------------------------------------------------------------------
   3. Ember backdrop

   A particle field on a canvas. `globalCompositeOperation = "lighter"` adds
   colour values together instead of painting over them, so overlapping embers
   get brighter — that is what makes it glow rather than look like stickers.
   -------------------------------------------------------------------------- */

const embers = (() => {
  const canvas = $(".bg__canvas");
  const ctx = canvas.getContext("2d");
  let parts = [];
  let raf = 0;
  let w = 0;
  let h = 0;
  let last = 0;
  let running = false;

  /*
    SPRITE CACHE
    Building a radial gradient costs real work, and doing it per particle per
    frame means ~5,000 allocations a second. Instead draw each colour ONCE into
    a small offscreen canvas, then stamp that bitmap with drawImage — which is
    a straight memory blit the GPU is very good at.
  */
  const SPRITE_COUNT = 6;
  const SPRITE_PX = 64;
  const sprites = Array.from({ length: SPRITE_COUNT }, (_, i) => {
    const hue = 348 + (i / (SPRITE_COUNT - 1)) * 22;
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE_PX;
    const g = c.getContext("2d");
    const mid = SPRITE_PX / 2;
    const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0, `hsla(${hue}, 95%, 66%, 1)`);
    grad.addColorStop(0.4, `hsla(${hue}, 95%, 58%, 0.5)`);
    grad.addColorStop(1, `hsla(${hue}, 95%, 52%, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    return c;
  });

  function resize() {
    // devicePixelRatio = how many physical pixels per CSS pixel. Capped at 2
    // because beyond that the extra fill cost buys nothing visible.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const target = Math.min(90, Math.round((w * h) / 26000));
    // `true` = scatter across the full height. Seeding with the normal spawn
    // would put every ember below the fold, so the field would look empty for
    // the first half-minute while they climbed into view.
    parts = Array.from({ length: target }, () => spawn(true));
  }

  function spawn(scatter = false) {
    return {
      x: Math.random() * w,
      y: scatter ? Math.random() * h : h + Math.random() * h * 0.4,
      r: 1 + Math.random() * 2.6,
      vy: 14 + Math.random() * 30,
      vx: -6 + Math.random() * 12,
      a: 0.22 + Math.random() * 0.48,
      sprite: sprites[Math.floor(Math.random() * SPRITE_COUNT)],
      drift: Math.random() * Math.PI * 2,
    };
  }

  function frame(now) {
    if (!running) return;
    // Delta time in seconds, clamped so a background tab doesn't teleport
    // every particle across the screen on the first frame back.
    const dt = Math.min((now - last) / 1000, 0.05) || 0;
    last = now;

    ctx.clearRect(0, 0, w, h);
    // "lighter" ADDS colour values instead of painting over them, so where two
    // embers overlap the result is brighter. That is what reads as glow.
    ctx.globalCompositeOperation = "lighter";

    for (const p of parts) {
      p.y -= p.vy * dt;
      p.drift += dt * 0.7;
      p.x += (p.vx + Math.sin(p.drift) * 9) * dt;

      if (p.y < -30) Object.assign(p, spawn());

      ctx.globalAlpha = p.a;
      const d = p.r * 12;
      ctx.drawImage(p.sprite, p.x - d / 2, p.y - d / 2, d, d);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener("resize", resize);
  resize();
  start();

  return { start, stop };
})();

/* -----------------------------------------------------------------------------
   4. Calm mode
   -------------------------------------------------------------------------- */

$('[data-toggle="calm"]').addEventListener("change", (e) => {
  document.body.classList.toggle("calm", e.target.checked);
  e.target.checked ? embers.stop() : root.dataset.backdrop === "embers" && embers.start();
});

/* -----------------------------------------------------------------------------
   5. Ripple

   getBoundingClientRect() gives the element's position in the viewport, so
   subtracting it from the pointer position converts to element-local coords.
   -------------------------------------------------------------------------- */

document.addEventListener("pointerdown", (e) => {
  const host = e.target.closest(".ripple");
  if (!host) return;

  const rect = host.getBoundingClientRect();
  const ink = document.createElement("span");
  // Diameter big enough to cover the element from any click point.
  const size = Math.hypot(rect.width, rect.height) * 2;

  ink.className = "ripple__ink";
  ink.style.width = ink.style.height = `${size}px`;
  ink.style.left = `${e.clientX - rect.left}px`;
  ink.style.top = `${e.clientY - rect.top}px`;

  host.appendChild(ink);
  ink.addEventListener("animationend", () => ink.remove());
});

/* -----------------------------------------------------------------------------
   6. Tilt & magnet
   -------------------------------------------------------------------------- */

const tilt = $("[data-tilt]");
const magnet = $("[data-magnet]");

tilt.addEventListener("pointermove", (e) => {
  const r = tilt.getBoundingClientRect();
  // Normalise the pointer to -0.5 … +0.5 across the card.
  const px = (e.clientX - r.left) / r.width - 0.5;
  const py = (e.clientY - r.top) / r.height - 0.5;

  tilt.style.transition = "transform 0.08s linear";
  // Y rotation follows horizontal movement, X rotation is inverted so the card
  // leans *toward* the cursor rather than away from it.
  tilt.style.transform = `rotateY(${px * 16}deg) rotateX(${-py * 16}deg) translateZ(6px)`;
  tilt.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
  tilt.style.setProperty("--my", `${(py + 0.5) * 100}%`);

  const mr = magnet.getBoundingClientRect();
  const dx = e.clientX - (mr.left + mr.width / 2);
  const dy = e.clientY - (mr.top + mr.height / 2);
  const dist = Math.hypot(dx, dy);
  // Only attract inside a 120px radius, and never move more than ~8px.
  const pull = Math.max(0, 1 - dist / 120) * 0.3;
  magnet.style.transform = `translate(${dx * pull}px, ${dy * pull}px)`;
});

tilt.addEventListener("pointerleave", () => {
  tilt.style.transition = "";
  tilt.style.transform = "";
  magnet.style.transform = "";
});

/* -----------------------------------------------------------------------------
   7. Spring panel & line-art replay
   -------------------------------------------------------------------------- */

const springBox = $("[data-springbox]");

$("[data-spring]").addEventListener("click", () => {
  if (springBox.hidden) {
    springBox.hidden = false;
    springBox.classList.remove("is-leaving");
    return;
  }
  // Exit animations need the element to stay in the DOM until they finish.
  springBox.classList.add("is-leaving");
  springBox.addEventListener("animationend", () => (springBox.hidden = true), { once: true });
});

$("[data-replay]").addEventListener("click", () => {
  $$(".draw").forEach((el) => {
    el.style.animation = "none";
    // Reading offsetWidth forces the browser to apply the "none" immediately,
    // so re-adding the animation actually restarts it. Without this the
    // browser batches both changes and nothing appears to happen.
    void el.offsetWidth;
    el.style.animation = "";
  });
});

/* -----------------------------------------------------------------------------
   8. Chat preview
   -------------------------------------------------------------------------- */

const log = $("[data-log]");
const typing = $("[data-typing]");
const scroller = $(".chat__scroll");
const input = $("[data-input]");

const REPLIES = [
  "Scanning the working directory — three services matched. Want the diff summary or the full trace?",
  "Done. The sweep animation is a CSS mask, so it costs nothing on the main thread.",
  "I can wire this into the real dashboard behind a theme flag, so you can switch back any time.",
  "Red reads as alert, which is why the glow is reserved for state changes rather than decoration.",
];
let replyIndex = 0;

function addMessage(text, who) {
  const el = document.createElement("div");
  el.className = `msg msg--${who}`;
  el.textContent = text;
  log.appendChild(el);
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  return el;
}

function streamReply() {
  typing.hidden = false;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });

  setTimeout(() => {
    typing.hidden = true;
    const text = REPLIES[replyIndex++ % REPLIES.length];
    const el = addMessage("", "bot");
    el.classList.add("is-streaming");

    let i = 0;
    const tick = setInterval(() => {
      // Step a few characters at a time so it feels like token streaming
      // rather than a typewriter.
      i += 2 + Math.floor(Math.random() * 3);
      el.textContent = text.slice(0, i);
      scroller.scrollTo({ top: scroller.scrollHeight });
      if (i >= text.length) {
        clearInterval(tick);
        el.textContent = text;
        el.classList.remove("is-streaming");
      }
    }, 26);
  }, 700);
}

$("[data-composer]").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, "me");
  input.value = "";
  input.style.height = "auto";
  streamReply();
});

// Enter sends, Shift+Enter makes a new line.
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("[data-composer]").requestSubmit();
  }
});

// Grow the textarea to fit its content, up to the CSS max-height.
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

/* Activity tab ------------------------------------------------------------- */

const EVENTS = [
  ["turn.start", "20:31:04"],
  ["tool.shell", "20:31:05"],
  ["tool.read_file", "20:31:06"],
  ["assistant.delta", "20:31:07"],
  ["turn.end", "20:31:09"],
];

const activity = document.createElement("div");
activity.className = "chat__log";
activity.hidden = true;
activity.innerHTML = EVENTS.map(
  ([name, time]) => `
    <div class="msg msg--bot" style="max-width:100%;display:flex;justify-content:space-between;gap:12px">
      <code>${name}</code><small style="color:var(--text-3)">${time}</small>
    </div>`,
).join("");
log.after(activity);

wireSegment($('[data-seg="chattab"]'), {
  btnSel: ".tab",
  thumbSel: ".tab__thumb",
  onChange(value) {
    const showChat = value === "chat";
    log.hidden = !showChat;
    activity.hidden = showChat;
    typing.hidden = true;
  },
});

/* -----------------------------------------------------------------------------
   9. Readouts
   -------------------------------------------------------------------------- */

const fpsEl = $("[data-fps]");
const layersEl = $("[data-layers]");

function readout() {
  layersEl.textContent = `${root.dataset.backdrop} · ${root.dataset.glass}`;
}

let frames = 0;
let since = performance.now();

function sampleFps(now) {
  frames++;
  if (now - since >= 1000) {
    fpsEl.textContent = String(Math.round((frames * 1000) / (now - since)));
    frames = 0;
    since = now;
  }
  requestAnimationFrame(sampleFps);
}
requestAnimationFrame(sampleFps);

readout();
addMessage("Show me what this theme can do.", "me");
streamReply();
