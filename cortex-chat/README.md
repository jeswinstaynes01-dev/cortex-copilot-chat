# Cortex

A standalone AI chat interface, built from a video reference with the purple
palette translated to **red/rose**, and wired to the Copilot agent running
behind the Spring Boot service in `../copilot-dashboard/backend`.

Every control on screen does something. Anything that could not be backed by a
real capability was deleted rather than left as decoration — see
[section 5](#5-wiring-it-to-a-real-backend) for the full audit.

```bash
npm install
npm run dev              # http://localhost:5174

# ...with the Spring Boot backend on :8080:
cd ../copilot-dashboard/backend && mvn spring-boot:run
```

Open `http://localhost:5174/?mock` to run against the built-in simulator
instead — useful for working on the design without a backend, and for the
screenshot harness.

---

## 1. What is where

```
src/
  App.tsx              the shell: sidebar + main pane; picks the real client
                       or the simulator from the `?mock` query parameter
  components/
    Orb.tsx            the glass bubble
    Sidebar.tsx        logo, New chat, search, merged chat history, status card
                       (connection, model, persona, premium-request quota)
    TopBar.tsx         model menu + Copy transcript + Export chat
    ModelMenu.tsx      model list (Copilot + your own key), effort, persona,
                       auto-approve switch + confirm, MCP tools, working dir
    Welcome.tsx        orb + "Hello, Jeswin" + "How can I assist you today?"
    Composer.tsx       the input card + the Thinking toggle + `/` commands
    CommandPalette.tsx the `/` command list — keyboard access to 5.9
    Suggestions.tsx    the 3 prompt cards (below the composer)
    Thread.tsx         the message list, tool chips, reasoning, notices
    CodeBlock.tsx      a fenced block: language, Copy, highlighted tokens (5.15)
    Permission.tsx     the approve / reject card — the agent BLOCKS on this
    Icons.tsx          every icon, hand-drawn as SVG (no icon library)
  lib/
    types.ts           the ChatClient contract
    commands.ts        the `/` command registry + the draft parser (5.9)
    effort.ts          the reasoning-effort labels, shared by the menu and `/effort`
    prompts.ts         the prompt library: built-in QA prompts + saved ones (5.14)
    copilotClient.ts   the real one: REST + Server-Sent Events
    mockClient.ts      the simulator, same contract, no network
    useChat.ts         conversation state + localStorage
    transcript.ts      markdown export, clipboard
    markdown.tsx       tiny safe markdown renderer
    highlight.ts       a tiny tokenizer that colours code blocks (5.15)
    *.test.ts(x)       Vitest unit tests for the pure logic (5.16)
    ripple.ts          the click ripple
    ambient.ts         decides how much decorative motion this machine can afford (3.11, 3.12)
  styles/
    tokens.css         all colours, shadows, easings, sizes
    base.css           reset, buttons, focus rings, tooltips
    layout.css         backdrop, window, sidebar, popovers, status
    chat.css           orb, welcome, cards, messages, permissions, composer
    responsive.css     the breakpoints

shot.mjs               the screenshot + health harness (section 6)
perf.mjs               frame-rate and hover-latency probe (3.11)
tsconfig.test.json     type-checks the tests in `tsc -b` without shipping them (5.16)
```

---

## 2. The colour decision (and why a hue rotation was the wrong answer)

The reference is built almost entirely from **one hue** — violet, around 260°.
Everything from the faintest pill tint to the orb is a lighter or darker
version of that single colour. That is why it looks coherent.

The obvious way to make it red is to rotate the hue from 260° to 350° and keep
saturation and brightness the same. I tried it. The main accent `#a577fd`
became `#fd8296` — **bubblegum pink**, not red.

Here is why. Violet at high brightness reads as "electric" and "premium".
Red at that *same* brightness reads as "candy". Red's identity lives at a
**lower lightness and higher saturation**. So:

- **Tints** (the pale backgrounds) — rotated mechanically. They work perfectly.
- **Accents** (the parts you actually notice) — hand-tuned.

### The two-tier accent

Checking contrast turned up something worth knowing: **the reference's own
purple on white is 3.10:1**. The accessibility standard for normal text is
4.5:1. The reference fails it. It is a pretty picture, not a shipped product.

So the accent is split in two:

| Token         | Value     | Used for                                  |
| ------------- | --------- | ----------------------------------------- |
| `--accent`    | `#e3102f` | fills, glows, the mic button, borders     |
| `--accent-ink`| `#c2102e` | any text — 6.16:1 on white, passes AA     |

`--accent-ink` was deliberately chosen to clear 4.5:1 against **both** white
*and* the pink tints the app paints behind text (`#c2102e` on `--tint-200` is
4.81:1). An accent that only passes on white will fail the moment you drop it
onto a tinted chip, which is exactly where accent text tends to live.

**Rule of thumb:** the bright accent that makes a design look good almost never
passes contrast for text. Split it.

---

## 3. Techniques, explained line by line

### 3.1 Gradient text

```css
.welcome__greet {
  background: linear-gradient(96deg, #9e0b24 0%, #e3102f 38%, #ef2d47 70%, #ff5b6e 100%);
  background-size: 180% 100%;
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}
```

- `linear-gradient(96deg, …)` — a colour ramp. `96deg` is the direction it
  travels (0deg = upward, 90deg = left-to-right, so 96 is a hair off level).
  Each `0%` / `38%` is a **stop**: "be exactly this colour at this position".
- `background-size: 180% 100%` — make the gradient **wider than the element**.
  You now only see part of it, which means there is somewhere to slide to.
- `background-clip: text` — "only paint this background where glyph pixels
  are." The background is now shaped like the letters.
- `color: transparent` — if the text still had a colour it would paint **on
  top** of the gradient and hide it.
- `-webkit-text-fill-color: transparent` — **both are required.** `color`
  covers standards-mode engines; the `-webkit-` property is what actually wins
  in Chrome and Safari. Drop it and the text goes solid black.

The shimmer then animates `background-position` from `0%` to `100%`, sliding
that oversized gradient across the letters.

### 3.2 The "liquid" orb — and a bug worth remembering

A circle that changes size still looks like a circle. What reads as *liquid* is
an outline that is never quite a circle:

```css
@keyframes orb-morph {
  0%  { border-radius: 58% 42% 45% 55% / 48% 57% 43% 52%; }
  40% { border-radius: 52% 48% 38% 62% / 42% 60% 40% 58%; }
}
```

- Normally `border-radius: 50%` means "every corner, radius 50%".
- With **four values** you set each corner separately: top-left, top-right,
  bottom-right, bottom-left.
- The **slash** splits it further. Values *before* the slash are the four
  **horizontal** radii, values *after* are the four **vertical** radii, in the
  same corner order. Each corner is now an **ellipse**, not a quarter-circle.
- Eight numbers, all different, all drifting → a blob that wobbles.

#### Keep each edge's pair at 100%

In `58% 42% …` the two numbers are the horizontal radii of the *top* two
corners. **If the two radii along one edge add up to more than that edge's
length, the browser silently scales every radius down proportionally to make
them fit** — and the shape you wrote is not the shape you get.

So every pair that shares an edge sums to exactly 100%:

| Edge | Which two numbers | Must be ≤ 100% |
| --- | --- | --- |
| top | horizontal TL + horizontal TR | `58 + 42` |
| bottom | horizontal BL + horizontal BR | `55 + 45` |
| left | vertical TL + vertical BL | `48 + 52` |
| right | vertical TR + vertical BR | `57 + 43` |

Landing on exactly 100 also keeps the blob tangent to all four sides, so it
never appears to shrink inside its own box as it morphs.

The first version deviated only ±5 points from 50%. That is arithmetically a
wobble and visually a circle. It is now **±12**, which you can actually see.

#### Never let shape live only in a keyframe

The first version of `.orb__body` had **no `border-radius` of its own** — it
got its roundness entirely from `orb-morph`. That works right up until the
animation stops, and then the orb renders as a **hard pink square**.

It stopped for a very ordinary reason: Windows → Settings → Accessibility →
Visual effects → *Show animations* turned off. Chrome reports that as
`prefers-reduced-motion: reduce`, the stylesheet answered with
`animation: none !important`, and with the keyframes gone there was no
`border-radius` left anywhere.

```css
.orb__body {
  /* structure — always present */
  border-radius: 58% 42% 45% 55% / 48% 57% 43% 52%;
  /* decoration — may vanish */
  animation: orb-morph 16s ease-in-out infinite;
}
```

**The rule: a keyframe may only ever *modify* a property, never be the only
place that property is defined.** Anything that affects shape, size or
position needs a real static value in the base rule. Animations get switched
off for all sorts of reasons — an accessibility setting, a backgrounded tab,
an older engine, a CSS parse error earlier in the file.

#### What `reduce` actually asks for

`prefers-reduced-motion: reduce` is a **vestibular safety** setting. It means
"do not move things across my screen" — it does not mean "freeze the page".
So here:

| Switched off | Kept |
| --- | --- |
| the ring spin, the core drift, the cloud drift, the greeting shimmer, the breath's vertical lift | the breath's scale, the shape morph (`--orb-morph` → 15s), an opacity-only glow |

Nothing travels across the screen and nothing rotates, so it is safe — and the
orb stays alive rather than becoming a dead sticker.

### 3.3 Where you put the highlight decides the colour

The orb is one radial gradient with a white hotspot at `72% 22%`. The first
red-rose attempt kept the old stop positions:

```css
#ffffff 0%, #fff4f4 16%, #ffd7da 34%, ... #a50f26 100%
```

On screen that was a **pale pink bubble**, not a red rose — even though the
darkest stop was a deep crimson. The reason is that a radial gradient's stops
are distances *from the centre of the light*, and area grows with the square of
that distance. A stop at 34% is not "a third of the orb"; the band from 0–34%
still covers a big visible disc, and it was nearly white. The red only had the
outer rim left to live in.

The fix was to pull the light-coloured stops in hard, so saturated rose starts
by 38%:

```css
#ffffff 0%, #fff0f1 9%, #ffc4ca 21%, #fb8d9b 38%, #f1546c 56%, #dc1b3c 78%, #9c0e24 100%
```

**Takeaway:** when a tinted sphere looks washed out, the darkest stop is usually
fine. It is the *highlight* that is too wide. The same correction had to be
applied to `.msg__avatar`, which is the same gradient at 20px.

### 3.4 The halo that had a visible edge

The glow started as this, and showed a distinct off-centre disc rim:

```css
background: radial-gradient(circle at 44% 58%, rgba(…,0.4), rgba(…,0.16) 48%, transparent 70%);
```

Two things were wrong.

1. **`transparent 70%`.** With no sizing keyword a radial gradient defaults to
   `farthest-corner`, so 70% meant 70% of the distance to the furthest corner
   — which lands *well inside* the box. Past that stop the gradient is flat
   transparent, so there is a hard boundary where the colour stops.
2. **`at 44% 58%`.** Off-centre, so that boundary was a circle that did not
   share a centre with the orb — which is what made it look like something
   had slipped rather than something was glowing.

```css
background: radial-gradient(
  closest-side circle at 50% 50%,
  rgba(255,74,110,0.30)   0%,
  rgba(255,104,136,0.19) 34%,
  rgba(255,146,170,0.095) 56%,
  rgba(255,184,199,0.035) 74%,
  rgba(255,200,212,0)   100%
);
```

- `closest-side` sets the gradient's radius to the distance to the nearest
  edge — half the box width, since the box is square. The fade now finishes
  exactly at the edge, so there is nothing left to see a boundary of.
- Five stops with a **long, low-alpha tail**. A halo needs the last 30% of its
  travel to be almost invisible. Go from 0.16 straight to transparent and the
  eye finds the edge every time.

### 3.5 Clipping the caustics to the blob

The caustic arcs are circles — their shape comes from a radial **mask**, and
masks do not follow `border-radius`. That was fine when the body was nearly
circular. At ±12 points of deviation the arcs started poking out through the
flatter parts of the blob.

The fix is a wrapper, `.orb__inner`, that carries the **identical** morph —
same keyframes, same duration, same easing, started on the same tick — plus
`overflow: hidden`. It is always exactly the body's silhouette, so anything
that would escape gets trimmed at the glass edge, which is where a reflection
should end anyway.

Verified rather than assumed: the probe compares the computed `border-radius`
of `.orb__body` and `.orb__inner` and asserts they are string-identical.

### 3.6 Turning a cone of colour into a thin ring

The orb has a bright arc sliding around its inside edge — a caustic, like
light bending through glass. There are two of them, at different radii and
different speeds, running in **opposite directions**: a single arc reads as
one object spinning, whereas two crossing arcs read as light refracting.

```css
.orb__ring {
  background: conic-gradient(from 0deg, transparent 0deg, #fff 40deg, transparent 90deg, …);
  mask: radial-gradient(circle, transparent 77%, #000 86%, transparent 95%);
}
```

- `conic-gradient` sweeps colour **around** a centre point like a clock hand.
  On its own it fills the whole disc — a pie chart.
- `mask` controls **where the element is visible**. Black = visible,
  transparent = hidden.
- That radial mask is transparent in the middle (0–77%), black in a band
  (86%), transparent again past 95%. So only a **thin ring** of the pie chart
  survives.
- Spin the cone and the bright part travels around the rim.

### 3.7 Why the backdrop uses gradients, not blurs

A slowly drifting cloudy background is normally done with `filter: blur()` on
some shapes. **Don't.** `filter: blur()` on a large layer is the single most
expensive thing you can ask a browser to repaint, every frame.

A `radial-gradient` with a large radius is *already* soft — the browser
rasterises it once, for free. Then the layer is moved with `transform`, which
the compositor handles on the GPU without repainting anything.

```css
.backdrop__layer { inset: -25%; }                       /* oversized */
@keyframes drift-a { to { transform: translate3d(3%, -2%, 0) scale(1.06); } }
```

- `inset: -25%` — shorthand for `top/right/bottom/left: -25%`. The layer hangs
  25% off every edge so you never see a seam when it slides.
- `translate3d(…, 0)` instead of `translate(…)` — the `3d` form hints at GPU
  compositing.

**General rule:** animating `background-position`, `width`, `top` or `filter`
causes layout or paint work. Animating `transform` and `opacity` does not.

> This rule is necessary but **not sufficient**, and section 3.11 is the story
> of finding that out. The drift above animates only `transform` — and still
> turned out to be the most expensive thing on the page, because the layers are
> enormous and sit behind a translucent window. Cheap *property*, huge *area*.
> Measure before you optimise.

### 3.8 The stacking bug that cost the most time

The mobile drawer opened *underneath* its own dark scrim. The sidebar had
`z-index: 20`, the scrim had `18`, and 20 is bigger than 18 — yet the scrim won.

Two separate CSS rules caused it, both triggered by one property:

```css
.window { backdrop-filter: blur(24px) saturate(1.5); position: relative; }
```

1. **`backdrop-filter` creates a stacking context.** That means `z-index`
   values *inside* `.window` are only compared with each other. The whole
   window then flattens to whatever `z-index` its own ancestor has — which was
   `1`. The root-level scrim at `18` painted over everything. 18 > 1.

2. **`backdrop-filter` also becomes the containing block for `position: fixed`
   descendants.** The drawer was `position: fixed; top: 0; left: 0`, which was
   silently resolving against `.window` rather than the viewport. It only
   *looked* correct because the window nearly fills the screen.

The fix: move the scrim **inside** `.window` so the two elements are siblings
in the same stacking context, switch both to `position: absolute`, and add
`position: relative` to `.window` — because `backdrop-filter` creates a
containing block for *fixed* but **not** for *absolute*.

`filter` and `transform` do exactly the same thing. If a `z-index` is being
ignored, look up the tree for one of those three properties.

### 3.9 A CSS specificity trap

Paragraph spacing in assistant replies silently vanished:

```css
.md > * + * { margin-top: 13px; }   /* specificity 0-1-0 */
.md p       { margin: 0; }          /* specificity 0-1-1  <- wins */
```

Specificity counts `(ids, classes, elements)`. `.md p` has one class and one
element = `0-1-1`. `.md > * + *` has one class and two universal selectors,
and **`*` counts as zero** = `0-1-0`. So `.md p` wins and resets the margin.

The fix is to reset through the universal selector too, keeping both rules at
the same specificity so the **later** one wins:

```css
.md > *     { margin: 0; }
.md > * + * { margin-top: 13px; }
```

### 3.10 Small things that are easy to get wrong

| Thing | Why |
| --- | --- |
| `[hidden] { display: none !important }` | Any author `display` rule silently defeats the `hidden` attribute. |
| `textarea { font-size: 16px }` minimum | iOS Safari zooms the page on focus below 16px. |
| Reset `height = "auto"` before reading `scrollHeight` | Otherwise an auto-growing textarea only ever grows, never shrinks. |
| `e.nativeEvent.isComposing` guard on Enter | Without it, confirming a Japanese/Chinese IME candidate sends the message. |
| `display: block` before `text-overflow: ellipsis` | Ellipsis never applies to an inline box, so `<span>` needs it explicitly. |
| Don't put `role="listitem"` on a `<button>` | It replaces the button semantics; screen readers stop announcing it as clickable. |
| Never define shape only inside `@keyframes` | If the animation is switched off the element falls back to a square. See 3.2. |

### 3.11 The performance audit — what was actually slow

The UI felt laggy: hovers arrived visibly late. Measuring it first turned out
to matter more than any individual fix, because **every initial guess was
wrong**.

Baseline: **15fps**, and a hover that took **319ms** to respond. At 15fps a
single frame is 67ms, so nothing on the page *could* react faster than that.
The lag was not a slow transition — it was a starved frame budget.

#### The three real costs

| Cost | Gain when removed | Why it was expensive |
| --- | --- | --- |
| `.backdrop__layer` drift | 36 → 60fps | Two ~2160×1350px layers animating forever, behind a translucent window that covers the screen → full-viewport recomposite every frame |
| `backdrop-filter` on `.window` | 15 → 35fps | Clouds drift behind it, so the whole window is re-sampled and re-blurred *every frame, forever* |
| `mix-blend-mode: overlay` on `.backdrop__grain` | 24 → 36fps | Forces a full-screen layer to be blended with everything beneath it |

The prime suspects — the orb's `border-radius` morph and the greeting's
`background-position` shimmer, both flagged as "forcing paint" — cost about
**1fps each**. They looked guilty because they animate paint properties, but
they are small. Area matters more than property.

#### The lesson about `backdrop-filter`

`saturate(1.5)` with **no blur at all** still cost 15 → 22fps, and `blur(8px)`
was no better than `blur(24px)`. **The radius is irrelevant; having the
property at all is the cost.** And here it bought nothing — the backdrop is
already soft gradients, so blurring something soft returns something nearly
identical. Section 3.7 had already banned `filter: blur()` on the backdrop for
exactly this reason; `.window` quietly reintroduced the same cost by another
name.

It was replaced with `transform: translateZ(0)` and the fill raised `0.74 →
0.82` to recover the lost contrast.

> **`translateZ(0)` here is not a cargo-culted GPU hint.** `backdrop-filter`
> was silently providing two side effects that other rules depended on:
> `.window` was a **stacking context** (which is why the drawer's `z-index: 20`
> beats its scrim's `19` — see 3.8) and the **containing block for
> `position: fixed` descendants** (which is how the model panel anchors at
> ≤560px). `transform` re-establishes both. Remove it and *both* break, with
> nothing in the console. `shot.mjs` now hit-tests the drawer and measures the
> model panel so this cannot regress silently.

#### The drift: a scheduling fix, not a rendering one

The drift was the largest cost and the hardest. Every cheaper way of drawing
the same motion was measured and **all of them failed**: translate-only,
scale-only, opacity crossfade, `contain: paint`, a smaller inset, rasterising
at ¼/⅛/1⁄12 scale and upscaling, and `steps()` timing (which only reached
40–45fps). Window opacity was not the factor either — opaque + drift was still
36fps. The cost is the full-screen recomposite itself, which no amount of
redrawing avoids.

Deleting the drift would have worked, but the movement is what stops the
background looking like a flat JPEG.

So it became a **scheduling** problem. The drift takes a full minute per pass.
Nobody watches the background while aiming at a button, and nobody aims at a
button while watching the background — the two needs never genuinely overlap.
`src/lib/ambient.ts` pauses the animation on `pointermove` and resumes it
~900ms after the last one, via `animation-play-state` (which freezes in place
rather than resetting, so resuming is seamless). §3.12 later generalised this
from the backdrop alone to every ambient animation on the page.

This is done with **direct DOM class manipulation, not React state**. Routing
"is the pointer moving" through `useState` would re-render the whole tree on
every mouse move — far more expensive than the animation it relieves.

#### Measuring honestly

Three traps, each of which produced a confidently wrong number:

1. **Headed Chrome on this machine caps at 33fps even on `about:blank`.** That
   is a display ceiling, not an app problem. Always run a blank-page control
   before trusting a figure. Headless has a true 61fps ceiling and is the
   honest environment here.
2. **Synthetic `pointerover` events never trigger CSS `:hover`.** The probe
   must drive the real mouse, and must start its watcher *before* moving so the
   clock includes main-thread blockage — which is the part a user feels.
3. **The harness has its own floor.** Driving the mouse over CDP with
   `{steps: 4}` costs ~55ms before the pointer even lands, and an element only
   matches `:hover` on the *final* step. Reporting the raw number made a
   one-frame response look like a 90ms problem. `perf.mjs` now measures that
   floor and subtracts it.

#### Result

| | before | after |
| --- | --- | --- |
| fps while the pointer moves | 15 | **60** |
| hover response, sidebar row | 319ms | **36ms** |
| hover response, suggestion card | 197ms | **13ms** |
| idle fps (clouds drifting, by design) | 15 | 39 |

`idle fps` is deliberately not 60: that is the backdrop animating when nobody
is touching anything, which is exactly when it is free to.

> **This section's conclusion was right about the CSS and wrong about the
> machine.** Everything above was measured headless on a renderer capable of
> 61fps. §3.12 is what happened when the page still felt slow afterwards.

### 3.12 When the machine has no GPU

The measurements in §3.11 said the page was fast. On the actual machine it
still felt slow, and the reason was never in the CSS:

```
Win32_VideoController
  Microsoft Hyper-V Video            AdapterRAM: (none)
  Microsoft Remote Display Adapter   AdapterRAM: (none)   CurrentRefreshRate: 32

Chrome WEBGL_debug_renderer_info
  ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
```

Two synthetic adapters, no video memory, no hardware acceleration. Chrome
falls back to **SwiftShader** and paints every pixel on the CPU; the result is
then video-encoded by a remote display adapter locked to **32Hz** and sent
over a network. Headless Chrome reports 61fps on the same box because it has
no display pipeline at all — so the probe that said "fine" was answering a
different question from the one being asked.

**The cost model inverts.** `.orb__body` morphs an eight-value `border-radius`
across 21,000px² of seven-stop gradient and three box-shadows. §3.11 measured
that at about one frame per second and cleared it. Re-rasterised on a CPU
thirty times a second, forever, it is one of the most expensive things on the
page — and it competes for that CPU with the hover state the user is waiting
for. Area still matters more than property; what changed is that *frequency*
now matters as much as both.

Measured by forcing each mode on identical content:

| | normal | low |
| --- | --- | --- |
| idle fps (headless) | 34 | **61** |
| ambient animations running at rest | 11 | **0** |
| ambient animations running during interaction | 0 | 0 |
| hover feedback (row / card) | works | **works** |

`src/lib/ambient.ts` sets two independent attributes on `<html>`:

**`data-busy`** — ambient motion yields to interaction on *every* machine, not
just slow ones. Nobody studies drifting clouds while aiming at a button. This
generalises the earlier backdrop-only pause to all eleven animations.

**`data-perf="low"`** — ambient motion stops for good when the device cannot
sustain a frame rate. Nothing else stops: every gradient, shadow and blur
stays exactly as designed, and the orb keeps its uneven silhouette because the
base `border-radius` was always declared on the element rather than only in
the keyframes — the comment in `chat.css` insisting on that turned out to be
load-bearing. A still Cortex and a moving one are identical in a screenshot.

Duration tokens shorten too, which is the part that answers the original
complaint. A transition's duration is a promise about how many frames the user
will see it in, and at 32Hz the defaults land at 4.5, 7.7 and 13.4 frames —
few enough to read as discrete steps rather than motion. The eye registers
that stepping as the interface being slow to respond, even though it began
responding on the very first frame. `140/240/420ms` becomes `90/150/240ms`:
roughly three frames each, enough to read as a transition, too few to stutter.
Nothing goes to zero — an instant jump loses the link between cause and
effect, which is a real loss rather than a decorative one.

> **Detection takes the best of three samples, not an average.** The question
> is what the machine is *capable* of, not what it managed during the one
> second we happened to look. A capable machine that was loading data during
> the sample reports a low number once and sixty the rest of the time, and
> acting on the unlucky sample would strip its animations permanently for no
> reason. This was not hypothetical: the first version sampled once at 1.4s,
> which is exactly when `shot.mjs` takes its screenshots, so the harness
> condemned itself to low mode on every run. A genuinely capped display can
> never produce a fast sample, so the optimistic bias costs nothing — and it
> errs in the safer direction, since wrongly staying rich loses a few frames
> while wrongly dropping to low silently removes work the user asked for.

`shot.mjs` step 1b forces both modes explicitly and asserts the distinction
that matters: **motion stops, feedback does not.** A performance mode that
quietly disabled hover states would trade a visible problem for an invisible
one.

---

## 4. Responsive behaviour

| Width | What changes |
| --- | --- |
| `> 1100px` | Sidebar is a permanent column. |
| `≤ 1100px` | Sidebar becomes a slide-over drawer with a dark scrim. |
| `≤ 760px`  | Suggestion cards become a horizontal snap-scrolling row. |
| `≤ 560px`  | Window goes edge-to-edge, "Thinking" becomes icon-only, "Export chat" is hidden, the model menu is pinned to the viewport instead of the pill. |
| `height ≤ 640px` | The orb shrinks — on a short landscape screen the greeting and composer matter more. |

`prefers-reduced-motion: reduce` switches off everything that travels, spins or
scales, but keeps a slow in-place morph and an opacity breathe on the orb — see
section 3.2 for why that distinction matters.

---

## 5. Wiring it to a real backend

### 5.1 The honesty rule

The design came from a video, and a video only has to *look* like software.
Roughly a third of the controls in the first build were there because the
reference had them there: a sign-out button with nothing to sign out of, four
nav items with no destinations, a globe that did not browse, a microphone that
did not listen.

So the integration had one rule: **a control either maps to something the
backend can actually do, or it is deleted.** Nothing was left as a stub.

#### Removed

| Control | Why |
| --- | --- |
| Explore / Library / Files / History nav | No destinations. "History" duplicated the list directly below it. |
| User card (name, email, avatar) | The app never authenticated anyone. Replaced by a connection + usage readout, which is information the user genuinely needs. |
| Sign out | Nothing to sign out of. |
| Upgrade | No paid tier. |
| More (…) overflow | Empty menu. |
| Copy link | No link exists — a conversation has no URL. Became **Copy transcript**. |
| Composer: image picker, prompt bulb, settings chip, web globe | The agent reads files from its working directory and browses when it decides to. None of these had a switch behind them. |
| Saved prompts, Attach file | Never implemented. Their whole footer strip went with them. Saved prompts later came back as a real feature, behind `/prompt` — see 5.14. |
| Microphone | Promised voice input that did not exist. Now the Send button is simply *disabled* when the box is empty. |
| Translate / Help floating buttons | Decorative. |
| "Join our Discord" footnote | There is no Discord. |
| Ten seeded chat titles | Every one opened an empty thread. The history list now starts empty and fills up as you use it. |

#### Made real

| Control | Now does |
| --- | --- |
| New chat | `client.reset()` — abandons the backend session and starts fresh. |
| History item | `client.resume(sessionId)` — re-attaches to that conversation's agent session if it is still alive. |
| Search | Filters the history, by title **and** message body. |
| Model pill | Opens a real menu populated from `GET /api/config`. |
| Copy transcript / Export chat | Renders the conversation to markdown; clipboard or `.md` download. Disabled until there is something to copy. |
| Send | `POST /api/sessions/{id}/messages`. |
| Stop | `POST /api/sessions/{id}/abort`. |
| "Deeper Research" | Became **Thinking**, which reveals real `assistant.reasoning` events. |

#### Added — because the backend needs them

| Control | Why |
| --- | --- |
| **Permission card** | The single most important addition. The agent *blocks* on it. Without this UI, every file write or shell command appears to hang for `permissionTimeoutSeconds` (600) and then quietly fails. |
| Connection status dot | The backend is a separate process that may not be running. |
| Token usage | Agent sessions have a context limit you can actually hit. |
| Working directory | The agent reads and writes real files. You should be able to see where. |
| Auto-approve switch | A real session flag. Turning it **on** asks for confirmation first; turning it off is one click. A confirmation you can only answer one way is a speed bump, not a safeguard. |
| Per-chat delete | Transcripts persist in `localStorage` forever otherwise. |
| Detached-session banner | See 5.5. |
| **Archived CLI history** | The sidebar merges in the Copilot CLI's own past conversations, read-only. See 5.6. |
| **Model + effort readout** | Which model is answering, and at what reasoning effort. See 5.7. |
| **Premium-request quota** | The account's live used / entitled premium requests and reset day, or a clearly marked estimate when the account can't be read. See 5.7 and 5.10. |
| **Persona** | A real session setting: instructions the backend appends to the system prompt. See 5.11. |
| **MCP tools readout** | Which tool servers every session gets. Read-only, because there is no switch behind it. See 5.12. |
| "No reasoning" note | With Thinking on, a finished reply that produced no reasoning says so, once, on the newest message. Otherwise a working toggle looks broken, because you cannot tell "this model does not expose reasoning" from "the feature is dead". |

### 5.2 The contract

Both clients implement the same interface, so no component can tell which one
it is talking to:

```ts
export interface ChatClient {
  getState(): ClientState;
  subscribe(cb: (s: ClientState) => void): () => void;
  models(): Promise<ModelOption[]>;          // ModelOption.provider: null = Copilot, else BYOK
  personas(): Promise<Persona[]>;           // 5.11
  mcpServers(): Promise<McpServer[]>;       // 5.12
  configure(patch: Partial<ClientSettings>): Promise<void>;   // settings.persona too
  checkDirectory(path: string): Promise<DirectoryCheck>;
  reset(): Promise<void>;
  resume(sessionId: string): Promise<boolean>;
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  send(opts: SendOptions, onDelta: (d: Delta) => void): () => void;
  archive(): Promise<ArchivedSession[]>;
  archiveTurns(id: string): Promise<ArchivedTurn[]>;
  budget(): Promise<Budget | null>;         // source, resetDate, unlimited (5.10)
  dispose(): void;
}
```

`send` takes a **callback** rather than returning an `AsyncIterable` (which is
what the mock-only version did). The reason is cancellation: the returned
function aborts the turn. With an async iterator you would have to `break` out
of a `for await` loop from somewhere outside the loop, which is awkward, and
`return()` on the iterator races with the next event.

The last three return `[]` / `null` on any failure rather than throwing. A
missing history database must never take down a working chat. `personas()`
and `mcpServers()` read the same cached `/api/config` answer as `models()`, so
opening the menu costs no extra round trip.

The endpoints behind it:

```
GET    /api/config                              -> models (incl. BYOK), personas, MCP servers,
                                                   BYOK provider summary, defaults, timeouts
GET    /api/config/working-directory?path=      -> { ok, resolved, error }  (5.9)
GET    /api/sessions                            -> SessionSummary[]
POST   /api/sessions                            -> 201 + new session (model, workingDirectory,
                                                   autoApprove, reasoningEffort, persona)
DELETE /api/sessions/{id}                       -> 204
GET    /api/sessions/{id}/events                -> Server-Sent Events
POST   /api/sessions/{id}/messages              -> 202, no body
POST   /api/sessions/{id}/abort                 -> 204
POST   /api/sessions/{id}/permissions/{reqId}   -> 204
GET    /api/history                             -> ArchivedSession[]   (read-only)
GET    /api/history/{id}                        -> ArchivedTurn[]      (read-only)
GET    /api/usage                               -> Budget: account quota or estimate (5.10)
```

Every URL is relative (`/api/...`), so the same build works behind the Vite
proxy and when Spring Boot serves the built UI from `http://localhost:8080/`.

### 5.3 Four bugs this integration had to solve

**1. The proxy was forwarding a stale `Origin`, and every write returned 403.**

`GET` worked. `POST` did not. The cause: a same-origin `GET` sends no `Origin`
header, but a same-origin `POST` does — and Vite's proxy forwarded
`Origin: http://localhost:5174` to a backend whose CORS allowlist contains only
the dashboard's own `http://localhost:5173`. Spring rejected it with a bare
403, which looks nothing like a CORS error.

`changeOrigin: true` does **not** fix this; it only rewrites `Host`. The fix is
to delete the header, which is also the more correct answer: once a proxy has
forwarded a request, the browser's `Origin` is stale information. The backend
is talking to the dev server, not to the page.

```ts
configure: (proxy) => {
  proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
},
```

**2. Reconnecting duplicated the whole reply.**

The backend replays its event buffer to *every* new subscriber, and
`EventSource` reconnects automatically. Naively appending every `message_delta`
meant a dropped connection produced the answer twice.

The client owns the text buffer and treats `dashboard.connected` as *"a replay
is about to start"*: it rewinds the buffer to `""` and emits a `text-replace`
delta, so the replay **rebuilds** the message instead of appending to it.

**3. A turn could finish twice.**

A turn can signal completion through both `session.idle` *and*
`dashboard.turn_end`. Firing `done` twice re-enables the composer in the middle
of a reply, so `finish()` is guarded by a `settled` flag.

**4. `response.json()` threw on every successful write.**

`202` and `204` responses have no body, and `json()` on an empty body throws
`Unexpected end of JSON input`. Read `text()` first and only parse if it is
non-empty.

### 5.4 Why the session is created lazily

Creating a session spawns a real Copilot CLI process on the server, so it
happens on the first **send**, not on mount — otherwise merely opening the tab
would start an agent. `GET /api/config` supplies the model name and working
directory for the UI without needing a session at all.

Model, working directory and auto-approve are fixed when the session is
created, and there is no update endpoint. `configure()` therefore deletes the
session and lets the next send create a replacement, which is why the model
menu warns you that changing a setting starts a new session.

### 5.5 Two different lifetimes

This is the one genuinely confusing thing about the architecture, and it is
worth stating plainly:

| | Lives in | Survives a browser reload | Survives a backend restart |
| --- | --- | --- | --- |
| The transcript you can read | `localStorage` | **yes** | **yes** |
| The agent's memory of it | a `ConcurrentHashMap` in the JVM | yes | **no** |

So a conversation can outlive the agent that produced it. Reopening one calls
`resume(sessionId)`, which checks whether the server still has that session; if
it does not, the chat is flagged `detached` and a banner says so. The
alternative — silently letting you ask a follow-up question about a
conversation the agent has no memory of — is far worse than admitting it.

`resume` asks for the session **list** and looks for the id, rather than
probing `GET /sessions/{id}` and catching the 404. Both work, but a detached
session is a completely normal outcome here, and it should not paint a red
error in the browser console every time.

### 5.6 The archive — a *third* lifetime

The Copilot CLI keeps its own history in a SQLite file at
`~/.copilot/session-store.db`. That is a completely separate store from the
backend's in-memory map:

| | Live agent sessions | The CLI archive |
| --- | --- | --- |
| Lives in | a `ConcurrentHashMap` in the JVM | SQLite on disk |
| Survives a backend restart | no | yes |
| Can you continue it | **yes** | **no** |
| Reached via | `/api/sessions` | `/api/history` |

They share an id space and nothing else. The sidebar merges them into one
date-grouped list, de-duplicated by session id, because "my past conversations"
is one idea to a user even if it is two to the machine. A `Row.kind` field
carries the distinction, so archived rows get an archive icon and a turn-count
badge instead of a delete button, and open into a read-only viewer with a
banner. **Read-only is not a limitation to work around — it is the truth.**
The process that produced those turns exited long ago; there is no agent left
to answer a follow-up.

Three rules govern `HistoryStore`:

1. **Open read-only.** `jdbc:sqlite:<path>?open_mode=1` is `SQLITE_OPEN_READONLY`.
   Without it the driver creates a journal file beside a database another
   process owns.
2. **Open per call, close immediately.** The file is small and polled rarely;
   a long-lived handle risks lock contention with the CLI itself.
3. **Never throw.** Every method catches `SQLException`, logs a warning, and
   returns empty.

Sessions with no summary, or with zero turns, are filtered out. Both are
records the CLI created before the first message ever arrived — they would
render as a clickable row that opens onto nothing.

A third filter removes **probes**, and it is the only heuristic in the class.
The CLI writes a generated title once a conversation has enough substance to
summarise ("Update User Interface", "Clone Bitbucket Repository"); until then
the title is just the opening message copied verbatim. So a title that is
still the first message echoed back marks a session that never became a
conversation — a scripted smoke test, a one-line probe, a "hi" typed to check
the wiring. Those are exactly the rows that bury real work.

An echo is not enough on its own. A long conversation that opened with a big
pasted brief keeps that brief as its title forever — a 111-turn mentoring
session here does precisely that, and hiding it would be a serious bug. So an
echo only counts as a probe when the conversation is **also** short (under 3
turns) or the title is a bare greeting (under 20 characters). Both tests have
to agree there is nothing worth keeping. On this machine that is 18 rows
hidden, 17 kept, with no false positives either way.

This *hides*; it never deletes. The database belongs to the CLI and is opened
read-only. Loosen `PROBE_TURNS` / `PROBE_TITLE_CHARS` and everything returns.

Timestamps are ISO-8601 UTC strings, so `created_at LIKE '2026-10%'` is both
correct and index-friendly, and far cheaper than parsing every row in Java.

### 5.7 The status card

Three stacked lines — four while a persona is set (5.11) — each answering a
question you would otherwise have to guess at.

**Connection + context.** A dot, the working directory, and tokens used of the
context window for the current session.

**Model + effort.** `auto` is not a model — it is an instruction to the runtime
to pick one. Displaying the literal string "auto" tells you nothing, so
`resolveModel()` looks up what the usage ledger says actually ran most
recently and shows *that*, tagged with an `AUTO` pill so the substitution is
never mistaken for a fixed choice. Beside it is the reasoning effort
(`LOW` / `MEDIUM` / `MAX`), which the CLI records **per request**, not per
session — so `effortFor()` takes the newest ledger row **for that model**, and
shows nothing when there isn't one.

> `effortFor()` used to fall back to the newest row for *any* model when the
> current one had no history. That read as a sensible default and was in fact a
> lie: selecting Claude Haiku — which supports no reasoning effort at all —
> showed a `MAX` badge borrowed from an earlier Sonnet request, directly beside
> a panel correctly saying Haiku has no effort setting. A badge next to a model
> name is read as a claim about that model. If we haven't seen it run, we have
> nothing to say.

The badge reads **`ran MAX`**, not `MAX`. That one word is load-bearing. The
model pill at the top of the window also shows an effort, and the two
legitimately disagree — the pill is what this chat is *set to*, the badge is
what the ledger says *happened*, across every session on the machine. Set a
new chat to `low` before sending anything and you will see `LOW` above and
`ran MAX` below, both true. Without the qualifier that looks like a bug, so
`shot.mjs` step 1 asserts the word is present rather than trusting it to
survive future edits.

This readout is also the answer to "why is the Thinking panel empty?". Models
differ in whether they expose reasoning at all, and at low effort many produce
none. Seeing `gpt-5.6-luna · LOW` in the corner explains an empty panel far
better than any error message could.

**Monthly budget.** GitHub bills *premium requests* by multiplier, not by
token: one request to `claude-opus-5` at max effort costs 15 units, one to a
small model costs 1. October showed 904 requests, 92M tokens, and 12,248
multiplier units — and only that last number sits sensibly against a 25,000
allowance, which is why `SUM(request_multiplier)` is the metric the local
estimate tracks. It counts **every** session on the machine, not just
Cortex's, because the allowance is shared. That ledger is now the *fallback*:
when the backend can read the account's own quota, the card shows that
instead — see 5.10.

### 5.8 Choosing the reasoning effort

The model menu has a second row of controls: how hard the model should think
before answering. Everything about its design came from asking the runtime
what is actually true rather than assuming a shape.

**Effort is not a scale, and it is not universal.** It is tempting to render a
slider from low to max. The runtime says otherwise — `getSupportedReasoningEfforts()`
returns a different set per model:

| Models | Efforts offered |
| --- | --- |
| `auto`, `claude-haiku-4.5` | *(none)* |
| `gpt-5-mini`, `grok-4.5`, `mai-code-1.1-flash` | low, medium, high |
| `gpt-5.3-codex`, `grok-4.6`, `grok-4.7` | low, medium, high, xhigh |
| `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` | **none**, low, medium, high, xhigh |
| Claude Opus / Sonnet | low, medium, high, xhigh, **max** |
| `gpt-6*`, `gpt-5.6*` | none, low, medium, high, xhigh, max |

Two things fall out of that table. Some models top out below others, so a
fixed slider would offer settings that silently do nothing. And `none` is an
*explicit, selectable* value on some models — meaningfully different from "not
offered", which is why the list is rendered as labelled chips rather than a
range. The whole set is three to seven short words; a dropdown would hide them
behind an extra click for no benefit.

**Two things the UI deliberately does not say.** `getDefaultReasoningEffort()`
returns `null` for *every* model, and `getBilling().getMultiplier()` likewise.
So no chip is marked "default", and **no cost warning appears anywhere** —
even though "max costs more" is almost certainly true. Both fields are still
carried through the API as `null`, which is the honest answer, rather than
being filled in with a plausible guess. The first chip is *"Model default"*,
meaning "we are not sending an effort at all" — a statement about our request,
which we can make truthfully, not about the model's internal preference, which
we cannot.

**An unsupported effort is dropped, not rejected.** The browser only ever
shows efforts the selected model supports, so a bad value can only arrive
mid-switch. Failing the request would strand the user on a model they just
chose. Instead `resolveEffort()` drops the value, logs a warning so it is not
a silent lie, and the applied value comes back on `SessionSummary` — which the
client then **adopts in place of what it asked for**. The pill can only ever
display what the session was genuinely built with. `configure()` also clears a
stranded effort when the model changes, unless the caller set both in the same
patch, which is a deliberate pairing rather than a leftover.

> `mockClient` duplicates that reconciliation on purpose. A more forgiving
> simulator would let the harness pass on combinations that break against the
> real backend.

**Effort is fixed when the session is created** — it is a `SessionConfig`
property, not a per-message flag. Changing it therefore starts a new agent
session, exactly as changing the model does, and the menu says so.

**Two "effort" readouts coexist, and they mean different things.** The pill on
the model button is *prescriptive*: what this session is set to. The badge in
the status card is *observational*: `ran low`, read from the usage ledger.
They are derived from completely separate sources, so when they agree that is
independent confirmation the setting took effect — which is exactly what step
3c of the harness checks, ending with a question to the server itself:

```
3c. reasoning effort follows the model
   {"model":"Claude Sonnet 5","checked":"low","pill":"Low"}
   {"afterSwitch":null,"afterReturn":null}
...
8. turn completes
   server session effort: low
```

The step is written against whatever the runtime advertises rather than
against hardcoded model names — it probes until it finds one model with
efforts and one without — because the mock sees four models, live sees
twenty-one, and GitHub rotates the list.

### 5.9 Slash commands

Typing `/` in the composer opens a palette. It is keyboard access to the
controls that already exist — not a second, parallel feature set. Every entry
calls the same handler as the button it mirrors:

| Command | Calls | Second stage |
|---|---|---|
| `/new` | `newChat()` | — |
| `/model` | `configure({ model })` | the real model list |
| `/effort` | `configure({ reasoningEffort })` | the levels *this* model has |
| `/persona` | `configure({ persona })` | None + the server's personas (5.11) |
| `/resume` | `openChat(id)` | recent chats |
| `/cd` | `configure({ workingDirectory })` | a **typed** path, checked first |
| `/thinking` | `setShowReasoning` | — |
| `/approve` | `configure({ autoApprove })` | on / off, **with a confirmation** |
| `/prompt` | inserts the prompt into the composer — **never sends** | built-in + saved prompts (5.14) |
| `/save` | `savePrompt(name, lastUserMessage)` | a **typed** name, or Enter for the default |
| `/unsave` | `deletePrompt(id)` | your saved prompts |
| `/copy` | `copyText(toMarkdown())` | — |
| `/export` | `download(...)` | — |
| `/stop` | `stop()` | — |

There is no `/help`: typing `/` already lists everything, so a command whose
only job is to reproduce the default view would be decoration. There is no
`/search` or `/attach` either — the agent decides for itself when to search,
and there is no upload endpoint. 5.1 applies here as it does everywhere.

**The draft is the state.** The palette is a pure function of the textarea's
contents — `parseSlash(draft)` decides whether it is open and which stage it is
in. Nothing is stored about "being in command mode". The payoff is that
behaviours you would otherwise have to write simply fall out:

* Backspacing the `/` closes it, because the string no longer parses.
* Enter on `/model` rewrites the draft to `/model ` — and that *is* the
  transition to the second stage.
* The text you typed is never lost, because it was never moved anywhere.

A draft containing a newline is never a command, which is also the escape
hatch for sending a message that genuinely begins with a slash. If nothing
matches, the palette says so and Enter sends the text verbatim:

```
/not-a-command     No command matches — press Enter to send as a message.
```

**Commands that cannot run say why.** `/stop` with nothing streaming stays in
the list, greyed, reading *"The agent isn't working right now"*. Hiding it
would be tidier and would teach the user nothing.

`/effort` is the sharpest case, because effort support is per model and is not
a scale — `auto` has none at all, Haiku has none, Sonnet runs low…max. So the
command resolves against the model actually in use, and when the model is
`auto` it refuses with the reason: *"Auto picks a model per request, so effort
can't be set ahead of time."*

**Two bugs worth keeping.**

> **Clicking a row ran a different row.** `onPointerDown` did
> `setIndex(i); accept()` — but `accept()` closed over the *previous* render's
> `index`, and React had not re-rendered in between. Clicking "Low" quietly
> ran "Model default". The fix is to pass the index explicitly
> (`acceptAt(i)`) rather than read it from state. The harness caught this
> only because it clicks with the mouse; the keyboard path had been correct
> all along, so a keyboard-only test would have passed forever.

> **`textContent` was `"/effortChoose an effort level"`.** Flex `gap`
> separates the breadcrumb and the prompt visually, but contributes no
> character — so screen readers and copy-paste got them run together. Same
> class of bug as `"ranmax"` in 5.7, same fix: a real `{" "}`.

**Focus never leaves the textarea**, which means the list is invisible to
assistive technology unless the textarea describes it. So the palette applies
the combobox pattern to an input it does not own — setting `role`,
`aria-expanded`, `aria-controls` and `aria-activedescendant` on the composer's
textarea from an effect, and *removing them on cleanup*. Leaving
`aria-activedescendant` pointing at a row that no longer exists would break the
textarea for the rest of the session.

On the rows themselves, two ARIA states that are easy to conflate:

* `aria-selected` — where the keyboard is right now
* `aria-checked` — the value actually in force

A screen reader needs both to say *"Claude Sonnet 5, checked, 3 of 21"*.

**Only `/approve` asks first.** Every other command is undone by running it
again; that one grants the agent unsupervised shell access on a real machine,
and `/a` + Enter should not be enough to do it. Escape backs out of the
question without granting anything — which the harness asserts explicitly,
because the failure mode is silent.

Escape is layered rather than absolute: confirmation → option list → closed.
A single Escape that jumped straight to closed would discard a half-typed
command someone was only trying to correct.

#### `/cd` — the only typed argument that can be wrong

Every other second stage is a *choice* from a list the app already has, or —
for `/save` — a name, where any text will do. Neither can be wrong. `/cd`
takes free text that has to name a real folder, which makes it the only
command that can be handed something that does not exist — and the only one
that has to be checked before it is accepted.

The backend always validated the folder. The defect was *when*. `configure()`
only writes local state and drops the session; settings are fixed at session
*creation*, so an unchecked typo is accepted happily and the 400 surfaces on
the **next message** — by which point that message has been typed and lost.
So the check had to move to before the accept, which needed a new endpoint:

```
GET /api/config/working-directory?path=...  →  { ok, resolved, error }
```

Four decisions in that one line:

* **200 even when `ok:false`.** A half-typed path is the normal state of an
  unfinished input, not a client error. Returning 4xx would print red errors
  in the console on every keystroke and train everyone to ignore them.
* **It returns the *resolved* path**, and that — not what was typed — is what
  the row displays. Typing `..` and seeing the absolute folder it means is the
  entire point: you approve what will actually happen, not the shorthand.
* **`SessionService.resolveWorkingDirectory` was made public and reused**
  rather than reimplemented. A separate "validation" copy would drift, and a
  check that disagrees with the real rule is worse than no check at all.
* **Existence only — never a listing.** A directory-listing endpoint would
  read the disk with nobody watching, whereas the agent's own file reads go
  through the permission prompt in 5.3.

A relative path resolves against the **server's** working directory, not the
user's — `..` returns `...\copilot-dashboard`, which is surprising. It is safe
only *because* the resolved path is shown before anything is committed.

This also forced a second kind of option source. `options()` and
`resolve(query)` have opposite caching needs:

| | `options()` | `resolve(query)` |
|---|---|---|
| Used by | `/model`, `/effort`, `/persona`, `/resume`, `/prompt`, `/unsave` | `/cd` |
| Fetched | once, when the command is entered | on every change, debounced 220ms |
| Why | refetching 21 models per keystroke is waste | the query *is* the thing being checked |

`/save` needed a third, `compute(query)`: nothing is fetched, and the single
row is rebuilt from the typing, so its label always says what Enter will do —
`Save as “…”`, and *Replaces the saved prompt with this name* when it will.

Dynamic lists are deliberately **not** passed through `filterByQuery`, because
`"C:\Users"` does not contain `"c:/users"` — filtering would hide the very
answer that was just looked up.

`CommandOption.disabled` exists for the same reason unavailable commands stay
visible (above): a rejected path is shown **with the server's own reason**
attached, rather than collapsing to an empty list that explains nothing. Enter
on a disabled row does nothing and keeps the text, so a typo is corrected
rather than retyped. Re-entering the folder already in use is refused too —
it would restart the session to arrive where it already is.

### 5.10 The quota — four honest shapes

The card used to read `31k / 25k this month` over a full bar. Both numbers
were real and neither answered the question: 31k was summed from this
machine's ledger, 25k was a budget typed into config. The account knows the
actual answer, so the backend now asks it, and `GET /api/usage` says which
kind of number it is returning. The card takes one of four shapes, decided in
this order:

| When | Card | Bar |
| --- | --- | --- |
| the selected model has a `provider` (5.13) | `Own model · openai` — not billed to Copilot | none |
| `unlimited: true` | `Unlimited` — premium requests | none |
| `source: "account"` | `1.2k / 1.5k` — `resets 1 Nov` | yes |
| `source: "estimate"` | `31k / 25k` **`est.`** — this month | yes |

* **Own key comes first** because it is a fact about the *model*, not the
  account: a bar over a model on your own key would be warning about a bill
  that model never adds to.
* **`est.` carries its reason** as a tooltip: the account couldn't be read, so
  this is the local ledger against the configured budget, and requests from
  other machines are missing. A response with no `source` at all — an older
  backend — is read as an estimate, because claiming account accuracy for a
  number nobody can vouch for is exactly what the old card did.
* **The reset day is formatted in UTC.** The allowance resets at midnight UTC
  on the first; read in local time west of Greenwich, that instant is still
  the 31st and the card would name the wrong day.
* **A zero budget** — a plan with no premium allowance — draws a full bar
  once anything is spent, instead of dividing by zero.

Every tooltip keeps the machine's own figures (requests, sessions, tokens), so
the ledger isn't lost when the account takes over; the account one adds
`remainingPercent` as "(17% left)". The simulator returns the `account` shape,
1,240 of 1,500 resetting on the first of next month, so harness step 1 can
assert the numbers, the date and the bar width.

### 5.11 Personas

A persona is a block of instructions the backend appends to the system prompt
— `qa-engineer`, `code-reviewer` and `eli5-tutor` today. The list comes from
`/api/config` through `personas()`, so a new one on the server needs no UI
change. It is chosen from chips in the model menu (*None* first, styled like
the effort chips, the description as the hint) or with `/persona`, and a badge
on the status card names it while one is set.

It behaves like effort (5.8), for the same reasons:

* **Fixed when the session is created.** `configure({ persona })` drops the
  session and the next send creates one with `persona` in the body — which the
  menu's "Changing this starts a new agent session" already says.
* **Dropped, not rejected.** The server ignores an unknown id and reports what
  it applied on `SessionSummary.persona`; the client adopts *that*, so the
  badge never names a persona the session doesn't have.
* **None is said out loud.** The server reads a *missing* persona as "use the
  configured default", so choosing None sends `"none"`. Always sending one
  loses nothing: the starting value is that default, taken from
  `defaultPersona` — and only if the server also lists it, or the badge would
  advertise something no session can apply.

Like model and effort, it is held by the client for the life of the tab: it
carries over to new and reopened chats, and returns to the server's default
on reload.

### 5.12 MCP tools — shown, not switched

The backend gives every session the MCP servers configured under
`copilot.mcp-servers` in `application.yml`, and `mcpServers()` lists them. The
model menu's **Tools (MCP)** section shows each server's name and transport
(`stdio` / `http`); the command line or URL, and which tools are allowed (`*`
reads "all"), are in the tooltip. An empty list says where to add one rather
than leaving a bare heading.

It is read-only on purpose. The servers are part of the backend's session
config and there is no per-session switch to send, so a toggle here would be
exactly the decorative control 5.1 removed.

### 5.13 Models on your own key

`ModelOption.provider` is `null` for a Copilot model, or `openai` / `azure` /
`anthropic` for one the backend reaches with the user's own key or endpoint —
a local Ollama model, say. The menu groups those under **Your own key**, each
with a provider badge, and offers them no effort chips because the server
reports none (`reasoningEfforts: []`). Selecting one swaps the quota bar for
`Own model · openai` (5.10).

All of that is decided from the per-model field. The `provider` summary on
`/api/config` (base URL, whether a key is configured) is not displayed — it
never contains the key, and nothing on screen needs it.

### 5.14 The prompt library

`prompts.ts` holds six built-in QA prompts — *Test cases from a story*,
*Regression scope*, *Bug report from notes*, *Boundary values*, *API test
checklist*, *Review my test cases* — each ending on a label line (`Story:`,
`Change:`, `Notes:`, `Field or rule:`, `Endpoint:`, `Test cases:`) for the
material to be pasted under.

* **`/prompt` inserts; it never sends.** Choosing one replaces the command
  with the prompt's text, focused, caret at the end. A template sent on its
  own would ask the agent about nothing. Built-ins come first, then saved
  ones, filtered as you type.
* **`/save [name]`** keeps the last message *you* sent in this chat. With no
  name it uses the opening words, cut at a word near 40 characters. Saving
  over an existing name replaces it, and the row says so first. On an empty
  chat the command stays visible, disabled, with the reason.
* **`/unsave`** lists only saved prompts; built-ins cannot be removed.
* **Feedback** uses the composer's existing notice line: *Saved “…” — find it
  under /prompt*, *Removed “…”*.

Saved prompts live in `localStorage["cortex.prompts.v1"]`, versioned like the
chat store. Reading is defensive: not JSON, not an array, entries missing a
name or text, and repeated names are skipped, never thrown — the library is a
convenience and must not stop the composer opening. A missing or repeated id
is derived from the name rather than generated, because the store is re-read
on every change and a fresh random id would leave the row impossible to
delete. A failed write (private mode, full storage) is swallowed, so the
prompt still works for the rest of the visit.

### 5.15 Code blocks

`markdown.tsx` hands each fence to `CodeBlock.tsx`: a header with the language
(`ts` → *TypeScript*, no info string → *Code*), a **Copy** button, and the
code, coloured by `highlight.ts`.

* **The highlighter returns typed runs, not HTML.** One pass marks comments,
  strings, numbers and keywords; each run becomes a `<span>`, so model output
  can never inject markup. The runs always join back to the input exactly,
  which is what lets Copy hand over the original text. It knows Java,
  JavaScript / TypeScript (with JSX / TSX), JSON, SQL, Bash, PowerShell,
  Python, YAML, XML / HTML and CSS, under the usual fence spellings (`py`,
  `yml`, `ps1`, `shell`…). Anything else renders plain — and when it is wrong,
  it is wrong in colour only.
* **Colours are `--code-*` tokens** in tokens.css: warm ink on near-black
  rose, keywords in rose, strings in amber. The faintest, comments, still
  clears 6:1.
* **Copy** goes through `copyText()` in transcript.ts — the helper `/copy`
  uses — shows *Copied* for 1.5 s, and keeps its `aria-label` in step with
  what it shows.
* **Streaming.** An unterminated fence renders as a block still being written,
  so code appears as it arrives rather than as raw backticks. Copy is held off
  (*Writing…*) until the fence closes, so half a block can't be copied, and a
  half-arrived closing fence is hidden so the block doesn't jump when it
  lands. Once the reply is complete, an unclosed fence simply runs to the end,
  as CommonMark has it.
* **Layout.** Long lines scroll inside the block; the page never does
  (harness step 18 checks at 420px). Font ligatures are off: Cascadia Code
  draws `=>` as `⇒`, and code someone will copy should look like what they
  will paste.

### 5.16 Unit tests

```bash
npm test        # vitest run — no browser, no DOM
```

The harness proves the screens; these pin the pure logic underneath, where a
regression is cheap to catch and easy to miss by eye:

| File | Covers |
| --- | --- |
| `commands.test.ts` | `parseSlash`, `hasOptions`, `filterByQuery`, and the `/persona`, `/prompt`, `/save`, `/unsave` entries |
| `prompts.test.ts` | the six built-ins, save / load / delete, corrupt storage, default names |
| `highlight.test.ts` | each language, unterminated input, header labels |
| `markdown.test.tsx` | fences rendered with `react-dom/server`: header, Copy, tokens, escaping, half-streamed, CRLF |
| `transcript.test.ts` | the Markdown export, `slug`, and `copyText` with no clipboard |

Vitest is a devDependency only. `tsconfig.test.json` is a third project in
`tsc -b`, so `npm run build` type-checks the tests too, while
`tsconfig.app.json` excludes them — the app is checked exactly as it ships,
with no test-only module in its program.

---

## 6. Checks

```bash
npx tsc -b          # types
npx oxlint src      # lint
npm run build       # production bundle
npm test            # unit tests (5.16)

node shot.mjs          # 23 steps / 31 screenshots against the simulator
node shot.mjs --live    # the same run against the real agent on :8080

node perf.mjs          # frame rate + hover latency + animation inventory
```

`shot.mjs` drives a real Chrome, writes screenshots to `./shots`, and fails on
console errors, HTTP errors, horizontal overflow, or any element spilling
outside its container. It also asserts the negative: that the removed controls
listed in 5.1 are genuinely absent from the DOM.

Both scripts launch the system Chrome at its default Windows path. Set
`CHROME_PATH` to run them anywhere else — on a Linux CI box,
`CHROME_PATH=/usr/bin/google-chrome node shot.mjs`.

Step **10b** opens an archived CLI session and asserts the read-only banner is
shown, the turns rendered, and that no delete button exists — the three things
that distinguish an archived row from a live one.

Sections 5.10–5.15 each have steps of their own:

| Step | Asserts |
| --- | --- |
| 1 | the account quota: `1.2k / 1.5k`, `resets 1 Nov`, the bar's width, no `est.` |
| 3e | the MCP section, the own-key group and badge, and persona through the chips **and** `/persona` — badge on, badge off |
| 3f | `/save` disabled on an empty chat; `/prompt` fills the composer, caret at the end, **nothing sent** |
| 17 | `/save` stores the last message, `/prompt` offers it, `/unsave` removes it — checked in `localStorage` too |
| 18 | a code reply: language label, coloured tokens, Copy disabled mid-stream, the clipboard's contents, scrolling at 420px |
| 19 | the own-key model replaces the bar with `Own model · openai` |

Steps 18 and 19 are simulator-only: a live model can't be relied on to answer
with a code block, nor a live backend to have an own-key model configured.

The live run sends a real prompt, waits for a real permission request, approves
it, and checks the turn completes — which is the only way to be sure the
permission round trip actually works, since it is the one part of the flow that
cannot be exercised without the agent blocking on it.

Three notes on the harness, all of which cost time to discover:

- Never wait for `networkidle`. The SSE stream never closes, so the page is
  never idle and the wait always times out.
- Do not wait for the streaming caret to detach as a way of detecting "the
  turn ended". The caret only exists while there is text, so
  `state: "detached"` resolves *instantly* during the silent stretch before the
  first token arrives. Wait for the **Stop button** to disappear instead.
- The Windows clipboard hands text back with `\r\n` line endings even when
  `\n` was written, so step 18 normalises before comparing. The copy itself is
  exact; only the read-back is translated.

`perf.mjs` is the other half: `shot.mjs` asks *is it correct*, `perf.mjs` asks
*is it smooth*. It reports frames per second **while the pointer is moving**
(the only moment a dropped frame is felt), hover latency with the harness's own
~55ms overhead subtracted, long tasks, and an inventory of every infinitely
running animation with the area it covers. Section 3.11 explains what those
numbers caught and the three ways they can lie to you.

Healthy output looks like this — note that idle fps is *deliberately* below 60,
because that is the backdrop drifting while nobody is interacting:

```
fps while moving  60   ok
idle fps          39   background animation running (by design)
long tasks        0

hover latency (ms, harness floor of 55ms already subtracted)
  sidebar history row          36  ok
  new chat button              42  ok
  suggestion card              13  ok
  icon button            disabled  disabled, cannot hover
```

