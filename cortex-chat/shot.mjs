/**
 * Visual + health harness. Drives real Chrome against the dev server, writes
 * screenshots to ./shots, and reports anything suspicious.
 *
 *   node shot.mjs                       # simulator, deterministic, fast
 *   node shot.mjs http://localhost:5174 # same
 *   node shot.mjs --live                # the real agent on :8080 (slow)
 *
 * The simulator (`?mock`) is the default on purpose. It reaches states the
 * real agent only reaches occasionally — a blocking permission request, a
 * failed tool — and it does it in two seconds without spending model calls.
 *
 * Uses the installed system Chrome because `npx playwright install` is
 * blocked in this environment. Set CHROME_PATH to point elsewhere — CI on
 * Linux, say: CHROME_PATH=/usr/bin/google-chrome node shot.mjs
 */
import { chromium } from "playwright-core";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const live = args.includes("--live");
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:5174";
const URL = live ? base : `${base}/?mock`;
const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = "shots";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const problems = [];
const note = (m) => problems.push(m);
const step = (n, m) => console.log(`${n}. ${m}`);

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 2,
});

/* Cleared on the first load and then left alone. `addInitScript` would be
   tidier, but it re-runs on every navigation — including the reload in the
   last step, which would then only ever prove that storage is empty. */
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`);
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("   shot", name);
};

console.log(`→ ${URL}  (${live ? "LIVE backend" : "simulator"})\n`);

/* The app never goes network-idle once an SSE stream is open, so wait on the
   DOM and a known element instead of the network. */
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".window", { state: "visible" });
await page.waitForTimeout(1200);

/* ---- 1. Welcome --------------------------------------------------------- */
step(1, "welcome + empty history");
await shot("01-welcome");

const welcome = await page.evaluate(() => {
  const orb = document.querySelector(".orb");
  const greet = document.querySelector(".welcome__greet");
  const body = orb?.querySelector(".orb__body");
  return {
    orbPx: orb ? Math.round(orb.getBoundingClientRect().width) : null,
    orbRadius: body ? getComputedStyle(body).borderRadius.slice(0, 32) : null,
    greetFill: greet ? getComputedStyle(greet).webkitTextFillColor : null,
    cards: document.querySelectorAll(".card").length,
    /* History is no longer expected to be empty: past Copilot CLI sessions are
       merged in. What must be empty is the set of *live* chats — rows you can
       continue and delete. An archived row carries no delete button, so
       counting those is the cleanest way to separate the two. */
    liveChats: document.querySelectorAll('.history__row[data-kind="live"]').length,
    archivedChats: document.querySelectorAll('.history__row[data-kind="archived"]').length,
    statusText: document.querySelector(".status__text")?.textContent,
    model: document.querySelector(".status__modelname")?.textContent ?? null,
    effort: document.querySelector(".status__effort")?.textContent ?? null,
    budget: document.querySelector(".budget__text")?.textContent?.trim() ?? null,
    barPct: document.querySelector(".budget__fill")?.style.width ?? null,
    budgetKind: document.querySelector(".budget")?.getAttribute("data-kind") ?? null,
    budgetUsed:
      document.querySelector(".budget__text > span:first-child")?.textContent?.trim() ?? null,
    budgetNote: document.querySelector(".budget__note")?.textContent?.trim() ?? null,
    budgetEst: !!document.querySelector(".budget__est"),
    /* The simulator's quota resets on the first of next month. Worked out here,
       on the page's own clock, so the assertion can't go stale when the month
       turns over. */
    expectedReset: (() => {
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const day = first.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
      return `resets ${day}`;
    })(),
  };
});
if (!welcome.orbPx) note("Orb did not render");
if (welcome.greetFill !== "rgba(0, 0, 0, 0)")
  note(`Gradient greeting is not clipped to text (fill=${welcome.greetFill})`);
if (welcome.cards !== 3) note(`Expected 3 suggestion cards, found ${welcome.cards}`);
if (welcome.liveChats) note(`Expected no live chats on a fresh store, found ${welcome.liveChats}`);
if (!welcome.archivedChats) note("No archived CLI sessions appeared in history");
if (!welcome.model) note("Status card does not show the model in use");
if (!welcome.budget) note("Status card does not show the monthly allowance");
/* The status badge reports history, the model pill reports the current
   setting, and they legitimately disagree until a message is sent. The word
   "ran" is the only thing distinguishing them on screen, so it is asserted
   rather than left to survive on good intentions. */
if (welcome.effort && !/^ran\s/i.test(welcome.effort.trim()))
  note(`Status effort badge reads "${welcome.effort}" — missing the "ran" qualifier`);
/* The allowance used to read "31k / 25k this month" over a full bar, the
   estimate dressed up as fact. The simulator answers the way a live account
   does, so the card must show the account's numbers, the real reset day, and
   no "est." flag. Live numbers are whatever the account says, so only the
   shape is held to there. */
if (!live) {
  if (welcome.budgetKind !== "account")
    note(`Allowance should come from the account, got data-kind="${welcome.budgetKind}"`);
  if (welcome.budgetUsed !== "1.2k / 1.5k")
    note(`Allowance shows "${welcome.budgetUsed}", expected the account's "1.2k / 1.5k"`);
  if (welcome.budgetNote !== welcome.expectedReset)
    note(`Allowance note is "${welcome.budgetNote}", expected "${welcome.expectedReset}"`);
  if (welcome.budgetEst) note("Account allowance is flagged as an estimate");
  const bar = parseFloat(welcome.barPct ?? "");
  if (!(Math.abs(bar - (1240 / 1500) * 100) < 0.5))
    note(`Allowance bar is ${welcome.barPct}, expected ~82.7% (1240 of 1500)`);
} else if (welcome.budgetKind === "estimate" && !welcome.budgetEst) {
  note("Estimated allowance is not marked as an estimate");
}
console.log("  ", JSON.stringify(welcome));

/* ---- 1b. Degraded-hardware mode ----------------------------------------- */
/* This machine has no GPU — Chrome rasterises on the CPU and the remote
   display caps at 32Hz — so ambient.ts measures delivered frames and strips
   decorative motion when the device cannot sustain it. Two things have to
   hold, and the second is the one worth guarding: motion must stop, and
   interaction feedback must NOT. A "performance mode" that quietly disables
   hover states would trade a visible problem for an invisible one. */
step("1b", "low-perf mode stops decoration, not feedback");

const ambient = () =>
  page.evaluate(() => {
    const inf = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Infinity);
    return {
      running: inf.filter((a) => a.playState === "running").length,
      total: inf.length,
    };
  });

/* Both arms are forced explicitly. Detection runs on a timer during page load
   and may legitimately have decided either way by now — reading whatever it
   chose would make this test's meaning depend on how busy the machine was
   while the harness was taking screenshots. */
await page.evaluate(() => document.documentElement.removeAttribute("data-perf"));
await page.waitForTimeout(400);

/* Read at rest. Any pointer movement sets data-busy, which pauses the same
   animations for a different reason and would mask a broken low mode. */
const restNormal = await ambient();
if (!restNormal.running) note("No ambient animation is running in normal mode");

async function hoverChanges(sel, prop) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) return null;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(350);
  const read = () =>
    page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
  const before = await read();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450);
  const after = await read();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  return before !== after;
}

const feedbackNormal = {
  row: await hoverChanges(".history__row", "backgroundColor"),
  card: await hoverChanges(".card", "transform"),
};

await page.evaluate(() => document.documentElement.setAttribute("data-perf", "low"));
await page.waitForTimeout(500);
const restLow = await ambient();
const feedbackLow = {
  row: await hoverChanges(".history__row", "backgroundColor"),
  card: await hoverChanges(".card", "transform"),
};
await shot("01b-lowperf");

if (restLow.running !== 0)
  note(`low-perf mode left ${restLow.running} ambient animations running`);
for (const [name, was] of Object.entries(feedbackNormal)) {
  if (was && !feedbackLow[name])
    note(`low-perf mode killed hover feedback on ${name} — decoration, not feedback`);
}
await page.evaluate(() => document.documentElement.removeAttribute("data-perf"));
await page.waitForTimeout(300);
console.log(
  "  ",
  JSON.stringify({ restNormal, restLow, feedbackNormal, feedbackLow }),
);

/* ---- 2. Dead controls must stay dead ------------------------------------ */
step(2, "removed controls are actually gone");
const ghosts = await page.evaluate(() => {
  const sel = [
    ".nav__item",
    ".user",
    ".floaters",
    ".footnote",
    ".composer__foot",
    ".composer__saved",
    ".composer__attach",
  ];
  return sel.filter((s) => document.querySelector(s));
});
if (ghosts.length) note(`Decorative controls still in the DOM: ${ghosts.join(", ")}`);

/* Export and Copy have nothing to export yet, so they must be disabled. */
const idleActions = await page.evaluate(() => ({
  copy: document.querySelector('[aria-label="Copy transcript"]')?.disabled,
  exportBtn: document.querySelector(".topbar__wide")?.disabled,
}));
if (idleActions.copy !== true || idleActions.exportBtn !== true)
  note(`Copy/Export should be disabled on an empty chat: ${JSON.stringify(idleActions)}`);

/* ---- 3. Model menu ------------------------------------------------------ */
step(3, "model menu");
await page.click(".modelpill");
await page.waitForTimeout(700);
await shot("03-model-menu");

const menu = await page.evaluate(() => ({
  open: !!document.querySelector(".pop__panel"),
  models: document.querySelectorAll(".pop__item").length,
  hasSwitch: !!document.querySelector(".pop__switch input"),
  path: document.querySelector(".pop__path span")?.textContent ?? null,
}));
if (!menu.open) note("Model menu did not open");
if (menu.models === 0) note("Model menu listed no models");
if (!menu.hasSwitch) note("Auto-approve switch missing");
console.log("  ", JSON.stringify(menu));

/* ---- 3c. Reasoning effort ----------------------------------------------- */
/* Written against whatever the runtime actually advertises rather than against
   a hardcoded model name, because the two runs see different lists: the mock
   has four models, live has twenty-odd, and GitHub rotates them. So we probe
   until we find one model that exposes efforts and one that does not, then
   assert the invariants that must hold either way. */
step("3c", "reasoning effort follows the model");

const modelNames = await page.evaluate(() =>
  [...document.querySelectorAll(".pop__item")].map((i) => i.textContent.trim()),
);

async function selectModel(name) {
  if (!(await page.locator(".pop__panel").count())) {
    await page.click(".modelpill");
    await page.waitForTimeout(400);
  }
  await page.locator(".pop__item", { hasText: name }).first().click();
  await page.waitForTimeout(500);
  if (!(await page.locator(".pop__panel").count())) {
    await page.click(".modelpill");
    await page.waitForTimeout(400);
  }
  /* Scoped to the effort section: the persona row below it is built from the
     same chips, and counting those would make every model look like it takes
     an effort. */
  return page.evaluate(() => ({
    chips: [...document.querySelectorAll(".pop__effort .pop__chip")].map((c) => ({
      label: c.textContent.trim(),
      effort: c.dataset.effort ?? null,
      checked: c.getAttribute("aria-checked") === "true",
    })),
    note: document.querySelector(".pop__effort .pop__hint--block")?.textContent?.trim() ?? null,
    pill: document.querySelector(".modelpill__effort")?.textContent?.trim() ?? null,
  }));
}

let withEfforts = null;
let withNone = null;
for (const name of modelNames) {
  const state = await selectModel(name);
  if (state.chips.length && !withEfforts) withEfforts = { name, state };
  if (!state.chips.length && !withNone) withNone = { name, state };
  if (withEfforts && withNone) break;
}

if (!withEfforts) note("No model exposed any reasoning effort");
if (!withNone) note("No model lacked reasoning effort — the empty state is untested");

/* A model that cannot reason at a chosen effort must say so, not just show an
   empty space the user has to interpret. */
if (withNone && !withNone.state.note)
  note(`${withNone.name} offers no efforts and no explanation of why`);
if (withNone && withNone.state.pill)
  note(`${withNone.name} supports no effort but the pill shows "${withNone.state.pill}"`);

let chosenEffort = null;
if (withEfforts) {
  const picked =
    withEfforts.state.chips.find((c) => c.effort === "low") ??
    withEfforts.state.chips.find((c) => c.effort);
  chosenEffort = picked?.effort ?? null;

  if (!withEfforts.state.chips[0].checked)
    note("No effort chip is selected by default — the control has no resting state");

  await selectModel(withEfforts.name);
  await page.locator(`.pop__chip[data-effort="${chosenEffort}"]`).click();
  await page.waitForTimeout(400);
  await shot("03c-effort");

  const set = await page.evaluate(() => ({
    checked:
      document.querySelector('.pop__effort .pop__chip[aria-checked="true"]')?.dataset.effort ??
      null,
    pill: document.querySelector(".modelpill__effort")?.textContent?.trim() ?? null,
  }));
  if (set.checked !== chosenEffort)
    note(`Clicked "${chosenEffort}" but "${set.checked}" is checked`);
  if (!set.pill) note("Effort chosen but the pill badge does not show it");
  console.log("  ", JSON.stringify({ model: withEfforts.name, ...set }));

  /* The dangerous case: carry an effort to a model that cannot honour it. The
     setting has to be dropped, not quietly kept, or the pill would claim
     something the session was never built with. */
  if (withNone) {
    const moved = await selectModel(withNone.name);
    if (moved.pill)
      note(`Effort survived the switch to ${withNone.name}, which supports none`);

    const back = await selectModel(withEfforts.name);
    if (back.pill)
      note(`Effort came back by itself after a round trip (${back.pill})`);
    console.log("  ", JSON.stringify({ afterSwitch: moved.pill, afterReturn: back.pill }));
  }

  /* Leave a real effort set so the turn in step 5 exercises it end to end and
     step 8 can ask the server what it was actually built with. "low" keeps a
     live run fast; the point is that the value travels, not that it is large. */
  await selectModel(withEfforts.name);
  await page.locator(`.pop__chip[data-effort="${chosenEffort}"]`).click();
  await page.waitForTimeout(400);
}

if (!(await page.locator(".pop__panel").count())) {
  await page.click(".modelpill");
  await page.waitForTimeout(400);
}

/* Auto-approve hands the agent unsupervised shell access, so enabling it must
   ask first — and cancelling must leave the switch exactly as it was.
   The checkbox itself is visually hidden behind a custom track, so the click
   goes to the track, exactly as a real pointer would. */
await page.click(".pop__switch-track");
await page.waitForTimeout(400);
await shot("03b-autoapprove-confirm");
const confirm = await page.evaluate(() => ({
  shown: !!document.querySelector(".pop__confirm"),
  checked: document.querySelector(".pop__switch input")?.checked,
}));
if (!confirm.shown) note("Enabling auto-approve did not ask for confirmation");
if (confirm.checked === true) note("Auto-approve switched on before the user confirmed");

const cancel = await page.$$(".pop__confirm-actions .btn");
await cancel[1]?.click();
await page.waitForTimeout(300);
const afterCancel = await page.evaluate(() => ({
  shown: !!document.querySelector(".pop__confirm"),
  checked: document.querySelector(".pop__switch input")?.checked,
}));
if (afterCancel.shown) note("Cancelling left the auto-approve confirmation open");
if (afterCancel.checked) note("Cancelling still enabled auto-approve");
console.log("  ", JSON.stringify({ confirm, afterCancel }));

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
if (await page.locator(".pop__panel").count()) note("Escape did not close the model menu");

/* ---- 3d. Slash commands -------------------------------------------------
   Driven entirely from the keyboard, because that is the only way anyone
   will actually use it. Clicking the rows would prove the handlers work
   while leaving the part that matters — typing "/mo", Enter, Enter —
   completely untested. */
step("3d", "slash commands");
await page.click(".composer__field");
await page.type(".composer__field", "/");
await page.waitForTimeout(300);
await shot("03d-palette");

const opened = await page.evaluate(() => ({
  rows: document.querySelectorAll(".palette__row").length,
  first: document.querySelector('.palette__row[data-active="true"] .palette__name')?.textContent,
  /* The textarea must describe the list while it holds focus, or a screen
     reader hears nothing at all. */
  activeDesc: document.querySelector(".composer__field")?.getAttribute("aria-activedescendant"),
}));
if (opened.rows < 5) note(`Palette showed ${opened.rows} commands`);
if (!opened.first) note("No palette row was highlighted on open");
if (!opened.activeDesc) note("Composer did not point at the active palette row");
console.log("  ", JSON.stringify(opened));

/* A command that cannot run must say why rather than disappearing. Nothing
   is streaming at this point, so /stop is the honest example. */
const disabled = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".palette__row")];
  const stop = rows.find((r) => r.querySelector(".palette__name")?.textContent === "/stop");
  return {
    present: !!stop,
    marked: stop?.dataset.disabled === "true",
    reason: stop?.querySelector(".palette__hint")?.textContent,
  };
});
if (!disabled.present) note("/stop vanished instead of explaining itself");
if (!disabled.marked) note("/stop was offered while nothing is running");
if (!disabled.reason) note("/stop gave no reason for being unavailable");
console.log("  ", JSON.stringify(disabled));

/* Filter, then Enter — which should NOT run anything, because /model has a
   second stage. It should rewrite the draft and show the model list. */
await page.fill(".composer__field", "/mo");
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
await page.waitForTimeout(live ? 2500 : 600);
await shot("03d-palette-models");

const stage2 = await page.evaluate(() => ({
  draft: document.querySelector(".composer__field")?.value,
  crumb: document.querySelector(".palette__crumb")?.textContent,
  rows: document.querySelectorAll(".palette__row").length,
  messages: document.querySelectorAll(".msg").length,
  checked: !!document.querySelector('.palette__row[data-checked="true"]'),
}));
if (stage2.draft !== "/model ") note(`Enter did not advance the draft (got "${stage2.draft}")`);
if (stage2.crumb !== "/model") note("Second stage did not say which command it was in");
if (stage2.rows < 2) note(`Model list had ${stage2.rows} rows`);
if (stage2.messages !== 0) note("Choosing a command sent a message instead");
if (!stage2.checked) note("Model list did not mark the model currently in use");
console.log("  ", JSON.stringify(stage2));

/* Escape backs out one level, to the command list — not straight to closed.
   A second Escape dismisses it without destroying what was typed. */
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const backOut = await page.evaluate(() => ({
  draft: document.querySelector(".composer__field")?.value,
  crumb: !!document.querySelector(".palette__crumb"),
  open: !!document.querySelector(".palette"),
}));
if (!backOut.open) note("Escape closed the palette instead of backing out one level");
if (backOut.crumb) note("Escape left the palette inside the model stage");
console.log("  ", JSON.stringify(backOut));

await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const dismissed = await page.evaluate(() => ({
  open: !!document.querySelector(".palette"),
  draft: document.querySelector(".composer__field")?.value,
  activeDesc: document.querySelector(".composer__field")?.getAttribute("aria-activedescendant"),
}));
if (dismissed.open) note("Second Escape did not dismiss the palette");
if (!dismissed.draft) note("Escape destroyed the draft instead of just closing the list");
if (dismissed.activeDesc)
  note("Composer still points at a palette row that no longer exists");
console.log("  ", JSON.stringify(dismissed));

/* /effort is the honest-capability case: its options depend on the model, so
   the list has to be built from the model actually in use. Step 3c left the
   effort on Low, so re-selecting Low exercises the whole two-stage run path
   while changing nothing — which keeps step 8's server read-back valid. */
await page.fill(".composer__field", "/effort ");
await page.waitForTimeout(live ? 1200 : 500);
const effortStage = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".palette__row")];
  return {
    head: document.querySelector(".palette__head")?.textContent,
    labels: rows.map((r) => r.querySelector(".palette__name")?.textContent),
    checked: rows
      .find((r) => r.dataset.checked === "true")
      ?.querySelector(".palette__name")?.textContent,
  };
});
if (!effortStage.labels.includes("Model default"))
  note("/effort did not offer the model's own default");
if (effortStage.labels.length < 2) note("/effort listed no levels for a model that has them");
/* The same class of bug as "ranmax": flex `gap` separates the boxes visually
   but leaves textContent run together for screen readers and copy-paste. */
if (!effortStage.head?.includes("/effort ")) note(`Palette header ran together: ${effortStage.head}`);
console.log("  ", JSON.stringify(effortStage));

const lowRow = page.locator('.palette__row:has(.palette__name:text-is("Low"))');
if (await lowRow.count()) {
  await lowRow.first().click();
  await page.waitForTimeout(live ? 2000 : 800);
  const afterPick = await page.evaluate(() => ({
    open: !!document.querySelector(".palette"),
    draft: document.querySelector(".composer__field")?.value,
    pill: document.querySelector(".modelpill__effort")?.textContent,
  }));
  if (afterPick.open) note("Palette stayed open after choosing an effort");
  if (afterPick.draft !== "") note("Choosing an effort left text in the box");
  if (afterPick.pill !== "Low") note(`Pill says "${afterPick.pill}" after choosing Low`);
  console.log("  ", JSON.stringify(afterPick));
} else {
  note("/effort offered no Low level to select");
}

/* Auto-approve is the one command that asks before acting. Escape must back
   out of that question WITHOUT granting anything — the failure mode here is
   silently handing the agent unsupervised shell access. */
await page.fill(".composer__field", "/approve ");
await page.waitForTimeout(400);
await page.keyboard.press("Enter");
await page.waitForTimeout(350);
await shot("03d-palette-confirm");
const asked = await page.evaluate(() => ({
  question: document.querySelector(".palette__confirm-title")?.textContent,
  rows: document.querySelectorAll(".palette__row").length,
}));
if (!asked.question) note("/approve enabled auto-approve without asking");
if (asked.rows !== 0) note("Confirmation left the list underneath still selectable");

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.click(".modelpill");
await page.waitForTimeout(400);
const stillOff = await page.evaluate(
  () => document.querySelector(".pop__switch input")?.checked,
);
if (stillOff) note("Escaping the /approve confirmation still enabled auto-approve");
console.log("  ", JSON.stringify({ asked, autoApproveAfterEscape: stillOff }));
await page.keyboard.press("Escape");
await page.waitForTimeout(250);

/* /cd is the only command whose argument is TYPED rather than chosen, so it is
   the only one that can be given something that does not exist. The three
   refusals below all have to leave the working directory alone; the two
   accepts have to change it and then put it back, so steps 4-8 still run
   against the folder they expect. */
const cdRead = () =>
  page.evaluate(() => {
    const row = document.querySelector(".palette__row");
    return {
      head: document.querySelector(".palette__head")?.textContent,
      label: row?.querySelector(".palette__name")?.textContent,
      hint: row?.querySelector(".palette__hint")?.textContent,
      off: row?.dataset.disabled === "true",
    };
  });
/* Reading the committed folder means opening the model menu, which is the only
   place it is shown — and closing it again so the next assertion starts clean. */
const cdPath = async () => {
  await page.click(".modelpill");
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => document.querySelector(".pop__path span")?.textContent);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  return p;
};
/* The starting folder differs between mock and live, so it is READ rather than
   assumed, and the folder to move to is whichever of the pair it is not. Live
   runs use this machine's home folder and this project's folder, which are
   real on any machine; simulator runs use two entries from the mock's
   allowlist. Whatever it started as is what it must end as. */
const HOME = await cdPath();
const PAIR = live
  ? [homedir(), dirname(fileURLToPath(import.meta.url))]
  : ["C:\\Users\\you", "C:\\Users\\you\\workspace"];
const AWAY = PAIR.find((p) => p.toLowerCase() !== HOME?.toLowerCase()) ?? PAIR[0];

await page.fill(".composer__field", "/cd ");
await page.waitForTimeout(900);
await shot("03d-palette-cd");
const cdEmpty = await cdRead();
if (!cdEmpty.head?.includes("/cd ")) note("/cd header ran its own words together");
if (!cdEmpty.off) note("/cd offered to change the folder before a path was typed");

/* A path that does not exist must say WHY, in the server's own words, and must
   refuse Enter. Accepting it would only move the failure to the next message. */
await page.fill(".composer__field", "/cd C:\\nope\\nope\\nope");
await page.waitForTimeout(1100);
const cdBad = await cdRead();
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
const cdBadDraft = await page.inputValue(".composer__field");
if (!cdBad.off) note("A non-existent folder was offered as selectable");
if (!cdBad.hint) note("A rejected path gave no reason");
if (!cdBadDraft.startsWith("/cd ")) note("Enter on a rejected path cleared the box anyway");
if ((await cdPath()) !== HOME) note("A rejected path changed the working directory");
/* A real folder shows the RESOLVED absolute path, and Enter commits it. */
await page.fill(".composer__field", `/cd ${AWAY}`);
await page.waitForTimeout(1100);
const cdGood = await cdRead();
if (cdGood.off) note(`A real folder was refused: ${cdGood.hint}`);
if (cdGood.label !== AWAY) note(`/cd showed "${cdGood.label}" instead of the resolved path`);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
const cdMoved = await cdPath();
if (cdMoved !== AWAY) note(`/cd did not change the working directory (still ${cdMoved})`);
if ((await page.inputValue(".composer__field")) !== "") note("/cd left text in the box");

/* Re-offering the folder already in use is a no-op session restart, so it is
   refused too. Checking it here also proves the row tracks the CURRENT folder
   rather than a value captured when the palette first opened. */
await page.fill(".composer__field", `/cd ${AWAY}`);
await page.waitForTimeout(1100);
const cdSame = await cdRead();
if (!cdSame.off) note("/cd offered to restart the session for the folder already in use");

/* Put it back, which doubles as the second proof that committing works. */
await page.fill(".composer__field", `/cd ${HOME}`);
await page.waitForTimeout(1100);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
const cdBack = await cdPath();
if (cdBack !== HOME) note(`/cd could not return to ${HOME} (left at ${cdBack})`);
console.log("  ", JSON.stringify({ cdEmpty, cdBad, cdGood, cdSame, cdMoved, cdBack }));

/* A message that merely starts with "/" must still be sendable. */
await page.fill(".composer__field", "/not-a-command");
await page.waitForTimeout(250);
const unmatched = await page.evaluate(() => ({
  open: !!document.querySelector(".palette"),
  rows: document.querySelectorAll(".palette__row").length,
  advice: document.querySelector(".palette__empty")?.textContent,
}));
if (unmatched.rows !== 0) note("An unmatched command still highlighted a row");
if (!unmatched.advice?.includes("Enter")) note("Unmatched command did not say Enter still sends");
console.log("  ", JSON.stringify(unmatched));

/* /new has no second stage, so Enter runs it immediately and clears the box.
   Running it here also guarantees step 4 starts from a clean chat. */
await page.fill(".composer__field", "/new");
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
const ran = await page.evaluate(() => ({
  open: !!document.querySelector(".palette"),
  draft: document.querySelector(".composer__field")?.value,
  welcome: !!document.querySelector(".welcome"),
}));
if (ran.open) note("Palette stayed open after running a command");
if (ran.draft !== "") note(`Running a command left "${ran.draft}" in the box`);
if (!ran.welcome) note("/new did not return to the welcome screen");
console.log("  ", JSON.stringify(ran));

/* ---- 3e. Persona, MCP tools, own-key models ----------------------------- */
/* The three things the menu gained, all read from /api/config. Persona is the
   one with consequences — it is written into the system prompt when the
   session is created — so it is switched both ways and from both entry
   points. The status badge shows the persona the session came BACK with, not
   the one that was asked for, which makes it the "was it applied" check.
   The simulator's catalogue is known, so it is asserted exactly; a live
   backend's is whatever application.yml says, so there only the shape is. */
step("3e", "model menu: persona, MCP tools, own-key models");
await page.click(".modelpill");
await page.waitForTimeout(live ? 1500 : 500);

const extras = await page.evaluate(() => {
  const own = document.querySelector('.pop__list [role="group"]');
  return {
    toolsShown: !!document.querySelector(".pop__tools"),
    tools: [...document.querySelectorAll(".pop__tool")].map((t) => ({
      name: t.querySelector(".pop__item-name")?.textContent ?? null,
      type: t.querySelector(".pop__badge")?.textContent ?? null,
      title: t.getAttribute("title") ?? "",
    })),
    toolsHint: document.querySelector(".pop__tools .pop__hint")?.textContent ?? null,
    ownHeading: own?.querySelector(".pop__group")?.textContent?.trim() ?? null,
    ownModels: [...(own?.querySelectorAll(".pop__item") ?? [])].map((i) => ({
      name: i.querySelector(".pop__item-name")?.textContent ?? null,
      badge: i.querySelector(".pop__badge")?.textContent ?? null,
    })),
    /* A Copilot model wearing the badge would be claiming it costs nothing. */
    strayBadges: document.querySelectorAll(".pop__list > .pop__item .pop__badge").length,
    personas: [...document.querySelectorAll(".pop__persona .pop__chip")].map((c) => ({
      id: c.dataset.persona ?? null,
      label: c.textContent.trim(),
    })),
  };
});
if (!extras.toolsShown) note("Model menu has no Tools (MCP) section");
else if (!extras.tools.length && !extras.toolsHint?.includes("copilot.mcp-servers"))
  note("Empty MCP section does not say where servers are configured");
if (extras.strayBadges) note(`${extras.strayBadges} Copilot model(s) carry the own-key badge`);
if (!live) {
  const pw = extras.tools.find((t) => t.name === "playwright");
  if (!pw) note("MCP section does not list the simulator's playwright server");
  else {
    if (pw.type !== "stdio") note(`MCP server type reads "${pw.type}", expected stdio`);
    if (!pw.title.includes("npx -y @playwright/mcp@latest"))
      note("MCP server's command line is not in its tooltip");
  }
  const llama = extras.ownModels.find((m) => m.name === "Llama 3.2 (Ollama)");
  if (!llama) note("Own-key model is not listed under the own-key heading");
  else if (llama.badge !== "openai")
    note(`Own-key model badge reads "${llama.badge}", expected its provider`);
  if (extras.ownHeading !== "Your own key")
    note(`Own-key group heading reads "${extras.ownHeading}"`);
  const ids = extras.personas.map((p) => p.id).join();
  if (ids !== "none,qa-engineer,code-reviewer,eli5-tutor") note(`Persona chips are "${ids}"`);
}
console.log("  ", JSON.stringify(extras));

/* The new sections sit below the fold of a tall menu, so scroll the panel to
   put them in frame. */
await page.evaluate(() => {
  const p = document.querySelector(".pop__panel--model");
  if (p) p.scrollTop = p.scrollHeight;
});
await page.waitForTimeout(150);
await shot("03e-menu-extras");

const personaRead = () =>
  page.evaluate(() => ({
    badge: document.querySelector(".status__persona-name")?.textContent ?? null,
    checked:
      document.querySelector('.pop__persona .pop__chip[aria-checked="true"]')?.dataset.persona ??
      null,
    pill: document.querySelector(".modelpill__effort")?.textContent ?? null,
  }));
const realPersonas = extras.personas.filter((p) => p.id !== "none");

if (realPersonas.length) {
  const first = realPersonas[0];
  const before = await personaRead();
  await page.click(`.pop__persona .pop__chip[data-persona="${first.id}"]`);
  await page.waitForTimeout(live ? 2500 : 600);
  const on = await personaRead();
  await shot("03e-persona-on");
  if (on.checked !== first.id) note(`Clicked persona "${first.id}" but "${on.checked}" is checked`);
  if (on.badge !== first.label)
    note(`Status card shows persona "${on.badge}", expected "${first.label}"`);
  /* Persona travels with the session's other settings. It must not knock the
     effort chosen in 3c back to the default on its way through. */
  if (on.pill !== before.pill)
    note(`Choosing a persona changed the effort pill from "${before.pill}" to "${on.pill}"`);

  await page.click('.pop__persona .pop__chip[data-persona="none"]');
  await page.waitForTimeout(live ? 2500 : 600);
  const off = await personaRead();
  if (off.checked !== "none") note(`Chose no persona but "${off.checked}" is still checked`);
  if (off.badge) note(`Persona badge "${off.badge}" survived choosing None`);
  console.log("  ", JSON.stringify({ persona: first.id, before, on, off }));
} else if (!live) {
  note("Model menu offered no personas");
}
await page.keyboard.press("Escape");
await page.waitForTimeout(250);

/* The same switch from the keyboard, filtered and then Enter. The list has to
   mark the persona in force, and choosing one has to leave the box empty,
   exactly as /effort does. It ends back on None so step 4 runs as it always
   has. */
const second = realPersonas[1] ?? realPersonas[0];
if (second) {
  await page.click(".composer__field");
  await page.fill(".composer__field", "/persona ");
  await page.waitForTimeout(live ? 800 : 400);
  const personaStage = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".palette__row")];
    return {
      labels: rows.map((r) => r.querySelector(".palette__name")?.textContent),
      checked:
        rows.find((r) => r.dataset.checked === "true")?.querySelector(".palette__name")
          ?.textContent ?? null,
    };
  });
  if (personaStage.labels[0] !== "None") note("/persona does not lead with None");
  if (personaStage.checked !== "None")
    note(`/persona marks "${personaStage.checked}" as in force, expected None`);
  if (!live && personaStage.labels.join() !== "None,QA Engineer,Code Reviewer,ELI5 Tutor")
    note(`/persona listed ${personaStage.labels.join(", ")}`);

  await page.fill(".composer__field", `/persona ${second.label.toLowerCase()}`);
  await page.waitForTimeout(300);
  const activeRow = await page.evaluate(
    () => document.querySelector('.palette__row[data-active="true"] .palette__name')?.textContent,
  );
  if (activeRow !== second.label)
    note(`Filtering /persona landed on "${activeRow}", not "${second.label}"`);
  await shot("03e-palette-persona");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(live ? 2500 : 800);
  const viaSlash = await page.evaluate(() => ({
    open: !!document.querySelector(".palette"),
    draft: document.querySelector(".composer__field")?.value,
    badge: document.querySelector(".status__persona-name")?.textContent ?? null,
  }));
  if (viaSlash.open) note("Palette stayed open after choosing a persona");
  if (viaSlash.draft !== "") note("Choosing a persona left text in the box");
  if (viaSlash.badge !== second.label)
    note(`/persona chose "${second.label}" but the card shows "${viaSlash.badge}"`);

  await page.fill(".composer__field", "/persona none");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(live ? 2500 : 800);
  const cleared = await page.evaluate(
    () => document.querySelector(".status__persona-name")?.textContent ?? null,
  );
  if (cleared) note(`"/persona None" left the "${cleared}" badge on the card`);
  console.log("  ", JSON.stringify({ personaStage, activeRow, viaSlash, cleared }));
}

/* ---- 3f. Prompt library: insert ------------------------------------------ */
/* A template is inserted, never sent. Every built-in ends on a label line
   ("Story:") and the part that matters — the story — is what gets pasted
   under it, so the checks are: the text is in the box, the caret is after
   it, focus stayed put, and the thread is still empty. */
step("3f", "/prompt inserts a template without sending it");

/* Nothing has been sent in this chat, so /save has nothing to keep and must
   say so rather than save an empty prompt. */
await page.fill(".composer__field", "/save");
await page.waitForTimeout(300);
const saveEmpty = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".palette__row")].find(
    (r) => r.querySelector(".palette__name")?.textContent === "/save",
  );
  return {
    present: !!row,
    off: row?.dataset.disabled === "true",
    reason: row?.querySelector(".palette__hint")?.textContent ?? null,
  };
});
if (!saveEmpty.present) note("/save is missing from the palette");
if (!saveEmpty.off) note("/save was offered with nothing to save");
if (!saveEmpty.reason?.includes("send a message"))
  note(`/save is unavailable but says "${saveEmpty.reason}"`);

await page.fill(".composer__field", "/prompt ");
await page.waitForTimeout(400);
await shot("03f-palette-prompt");
const promptList = await page.evaluate(() =>
  [...document.querySelectorAll(".palette__row")].map((r) => ({
    name: r.querySelector(".palette__name")?.textContent,
    hint: r.querySelector(".palette__hint")?.textContent,
  })),
);
const builtIns = promptList.filter((p) => p.hint === "Built-in");
if (builtIns.length !== 6) note(`/prompt listed ${builtIns.length} built-in prompts, expected 6`);
if (promptList.length !== builtIns.length) note("A fresh store already lists saved prompts");

await page.fill(".composer__field", "/prompt story");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const inserted = await page.evaluate(() => {
  const f = document.querySelector(".composer__field");
  return {
    opening: f?.value.slice(0, 32) ?? null,
    endsOnLabel: f?.value.endsWith("Story:\n") ?? false,
    caretAtEnd: !!f && f.selectionStart === f.value.length && f.selectionEnd === f.value.length,
    focused: document.activeElement === f,
    palette: !!document.querySelector(".palette"),
    messages: document.querySelectorAll(".msg").length,
  };
});
await shot("03f-prompt-inserted");
if (!inserted.endsOnLabel) note("/prompt did not put the template, ending on Story:, in the box");
if (!inserted.caretAtEnd) note("Caret is not at the end of the inserted prompt");
if (!inserted.focused) note("Composer lost focus when the prompt was inserted");
if (inserted.palette) note("Palette stayed open after inserting a prompt");
if (inserted.messages !== 0) note("Choosing a prompt sent it instead of inserting it");
console.log("  ", JSON.stringify({ saveEmpty, prompts: promptList.length, inserted }));
await page.fill(".composer__field", "");

/* ---- 4. Compose --------------------------------------------------------- */
step(4, "composer + thinking toggle");
/* Live runs get a prompt that is guaranteed to need a shell permission but
   cannot change anything: the working directory is the user's real home
   folder, so the simulator's "create a file" prompt is not safe to fire at
   the actual agent. */
const PROMPT = live
  ? "Run the shell command `git --version` and tell me exactly what it printed. Do nothing else."
  : "Create a file called notes.md and write a summary into it.";
await page.click(".composer__field");
await page.fill(".composer__field", PROMPT);
await page.click(".toggle");
await page.waitForTimeout(320);
await shot("04-composer");

if ((await page.getAttribute(".toggle", "aria-pressed")) !== "true")
  note("Thinking toggle did not latch");
if ((await page.locator(".send:disabled").count()) !== 0)
  note("Send is still disabled with text in the box");

/* ---- 5. Send ------------------------------------------------------------ */
step(5, "streaming reply");
await page.click(".send");
await page.waitForTimeout(1500);
await shot("05-streaming");

const streaming = await page.evaluate(() => ({
  messages: document.querySelectorAll(".msg").length,
  reasoning: !!document.querySelector(".reason__body"),
  sendIsStop: !!document.querySelector('[aria-label="Stop generating"]'),
}));
if (streaming.messages < 2) note(`Expected 2 messages, found ${streaming.messages}`);
if (!streaming.sendIsStop) note("Send did not become Stop while busy");
/* Not all models emit `assistant.reasoning` events, so this is only an
   assertion against the simulator, which always does. */
if (!live && !streaming.reasoning) note("Thinking was on but no reasoning body rendered");
console.log("  ", JSON.stringify(streaming));

/* ---- 6. Permission ------------------------------------------------------
   The whole point of the integration. The backend blocks the turn here, so
   if this card does not appear the agent silently hangs for ten minutes. */
step(6, "permission request blocks the turn");
await page.waitForSelector(".perm", { timeout: live ? 90000 : 15000 }).catch(() => {
  note("Permission card never appeared");
});
await page.waitForTimeout(400);
await shot("06-permission");

const perm = await page.evaluate(() => {
  const el = document.querySelector(".perm");
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return {
    title: el.querySelector(".perm__kind")?.textContent,
    detail: el.querySelector(".perm__detail")?.textContent?.slice(0, 70),
    buttons: el.querySelectorAll("button").length,
    inView: b.top >= 0 && b.bottom <= innerHeight + 1,
    /* A typing animation next to a blocked agent would be a lie about who
       everyone is waiting for. */
    typingShown: !!document.querySelector(".typing"),
  };
});
if (perm && !perm.inView) note("Permission card is off-screen — it was not scrolled into view");
if (perm?.typingShown) note("Typing dots shown while the agent is blocked on a permission");
console.log("  ", JSON.stringify(perm));

step(7, "approve");
await page.click(".perm .btn--dark");
await page.waitForTimeout(900);
await shot("07-approved");
if (await page.locator(".perm").count()) note("Permission card survived the approval");

/* ---- 8. Settled --------------------------------------------------------- */
step(8, "turn completes");
/* Waits for the Stop button to disappear, not for the streaming caret. The
   caret only exists while there is text, so `state: "detached"` resolves
   instantly during the silent stretch before the first token — which made
   this step pass while the agent was still working. */
await page
  .waitForSelector('[aria-label="Stop generating"]', {
    state: "detached",
    timeout: live ? 240000 : 30000,
  })
  .catch(() => note("Turn never finished"));
await page.waitForTimeout(700);
await shot("08-conversation");

const settled = await page.evaluate(() => ({
  tools: document.querySelectorAll(".toolchip").length,
  toolStatus: [...document.querySelectorAll(".toolchip")].map((t) => t.dataset.status),
  busy: !!document.querySelector('[aria-label="Stop generating"]'),
  replyChars: document.querySelector(".msg--assistant .md")?.textContent?.length ?? 0,
  historyItems: document.querySelectorAll('.history__row[data-kind="live"]').length,
  tokens: document.querySelector(".status__tokens")?.textContent?.trim() ?? null,
  copyEnabled: document.querySelector('[aria-label="Copy transcript"]')?.disabled === false,
}));
if (settled.busy) note("Composer still shows Stop after the turn ended");
if (settled.tools === 0) note("No tool chips rendered");
if (settled.toolStatus.includes("running")) note("A tool chip is stuck on 'running'");
if (settled.replyChars < 10) note("The assistant produced no visible answer");
if (settled.historyItems !== 1)
  note(`Expected 1 live history entry, found ${settled.historyItems}`);
if (!settled.copyEnabled) note("Copy transcript still disabled after a reply");
console.log("  ", JSON.stringify(settled));

/* The pill in step 3c only proves the browser's intention. This asks the
   server what it actually built the session with — the one check that can tell
   the difference between a working setting and a convincing label. */
if (live && chosenEffort) {
  const sessions = await fetch("http://localhost:8080/api/sessions")
    .then((r) => r.json())
    .catch(() => null);
  const newest = sessions?.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) note("Could not read back any session from the server");
  else if (newest.reasoningEffort !== chosenEffort)
    note(`UI set effort "${chosenEffort}" but the server session has "${newest.reasoningEffort}"`);
  console.log("   server session effort:", newest?.reasoningEffort ?? "(unknown)");
}

/* ---- 9. Layout audit ---------------------------------------------------- */
step(9, "layout audit at 1440px");
const audit = await page.evaluate(() => {
  const r = {};
  const doc = document.documentElement;
  r.horizontalOverflow = doc.scrollWidth > doc.clientWidth + 1;

  /* Elements inside an `overflow:hidden` ancestor are skipped, because
     getBoundingClientRect reports pre-clip geometry and would flag the
     deliberately oversized decorative layers. */
  const clipped = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (getComputedStyle(n).overflow !== "visible") return true;
    }
    return false;
  };
  r.spills = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1) && !clipped(el);
    })
    .map((el) => el.className?.toString?.().slice(0, 40))
    .slice(0, 8);

  const c = document.querySelector(".composer");
  const m = document.querySelector(".main");
  r.composerInsidePane =
    !!c && !!m && c.getBoundingClientRect().bottom <= m.getBoundingClientRect().bottom + 1;
  return r;
});
if (audit.horizontalOverflow) note("Page scrolls horizontally at 1440px");
if (audit.spills.length) note(`Elements outside the viewport: ${audit.spills.join(", ")}`);
if (!audit.composerInsidePane) note("Composer overflows the bottom of the main pane");
console.log("  ", JSON.stringify(audit));

/* ---- 10. Search + delete ------------------------------------------------ */
step(10, "search filters, delete removes");
const liveRows = () => page.locator('.history__row[data-kind="live"]').count();
const beforeSearch = await liveRows();
await page.fill(".search input", "zzzznomatch");
await page.waitForTimeout(350);
const noMatch = await page.evaluate(
  () => document.querySelector(".history__empty")?.textContent ?? "",
);
if (!noMatch.includes("Nothing matches")) note("Search did not filter the history list");
await page.click(".search__clear");
await page.waitForTimeout(300);
if ((await liveRows()) !== beforeSearch)
  note("Clearing the search did not restore the list");
await shot("10-search");

/* ---- 10b. Archived CLI sessions are readable, not continuable ----------- */
step("10b", "open an archived CLI session");
const archived = page.locator('.history__row[data-kind="archived"] .history__item').first();
if (await archived.count()) {
  await archived.click();
  await page.waitForTimeout(900);
  await shot("10b-archived");
  const arc = await page.evaluate(() => ({
    banner: document.querySelector(".banner--archive")?.textContent?.trim().slice(0, 40) ?? null,
    messages: document.querySelectorAll(".msg").length,
    /* The row has no delete button by design: there is nothing of ours to
       delete, and we must never write to the CLI's own store. */
    deletable: !!document.querySelector('.history__row[data-kind="archived"] .history__del'),
  }));
  if (!arc.banner) note("Archived view did not show its read-only banner");
  if (!arc.messages) note("Archived session rendered no messages");
  if (arc.deletable) note("Archived rows must not offer a delete button");
  console.log("  ", JSON.stringify(arc));

  await page.click(".banner__close");
  await page.waitForTimeout(400);
  if (await page.locator(".banner--archive").count())
    note("Closing the archive banner did not return to the live chat");
} else {
  note("No archived sessions available to open");
}

/* ---- 11. Narrow viewports ----------------------------------------------- */
step(11, "tablet 1024 + drawer");
await page.setViewportSize({ width: 1024, height: 860 });
await page.waitForTimeout(500);
await shot("11-tablet");

const railHidden = await page.evaluate(() => {
  /* The drawer is parked outside the WINDOW's left edge, not the viewport's —
     the window is inset by the app padding. */
  const rail = document.querySelector(".rail").getBoundingClientRect();
  const win = document.querySelector(".window").getBoundingClientRect();
  return rail.right <= win.left + 2;
});
if (!railHidden) note("Sidebar is not parked off-screen below 1100px");

await page.click(".topbar__menu");
await page.waitForTimeout(560);
await shot("12-drawer");

const railShown = await page.evaluate(() => {
  const rail = document.querySelector(".rail").getBoundingClientRect();
  const win = document.querySelector(".window").getBoundingClientRect();
  return Math.abs(rail.left - win.left) < 2;
});
if (!railShown) note("Drawer did not slide in");

/* The drawer must paint ABOVE its own scrim, and that only works because both
   live inside `.window`'s stacking context. `.window` gets that context from
   `transform: translateZ(0)` — a line that looks like a removable GPU hint and
   has been removed once already. If it goes, the scrim covers the drawer and
   every control inside it stops responding, with nothing in the console.

   A hit test is the honest check: ask the browser what is actually on top at a
   point inside the drawer. Comparing z-index values would not catch it, since
   the bug is that the two stop being comparable at all. */
const drawerOnTop = await page.evaluate(() => {
  const rail = document.querySelector(".rail");
  const b = rail.getBoundingClientRect();
  const hit = document.elementFromPoint(b.x + b.width / 2, b.y + 120);
  return rail.contains(hit);
});
if (!drawerOnTop) note("Scrim is painting over the open drawer — .window lost its stacking context");

/* The scrim's centre is covered by the open drawer, so click the exposed
   sliver on the right. */
await page.click(".rail__scrim", { position: { x: 900, y: 430 } });
await page.waitForTimeout(520);

step(13, "mobile 420");
await page.setViewportSize({ width: 420, height: 880 });
await page.waitForTimeout(500);
await shot("13-mobile");

const mob = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  wideHidden: getComputedStyle(document.querySelector(".topbar__wide")).display === "none",
  fontPx: parseFloat(getComputedStyle(document.querySelector(".composer__field")).fontSize),
}));
if (mob.overflow) note("Page scrolls horizontally at 420px");
if (!mob.wideHidden) note("Export button still shown at 420px");
if (mob.fontPx < 16) note(`Composer font is ${mob.fontPx}px — iOS will zoom on focus`);
console.log("  ", JSON.stringify(mob));

/* Model menu at 420px is the easiest thing in the app to push off-screen. */
await page.click(".modelpill");
await page.waitForTimeout(500);
await shot("14-mobile-menu");
const menuFits = await page.evaluate(() => {
  const p = document.querySelector(".pop__panel");
  if (!p) return null;
  const b = p.getBoundingClientRect();
  return b.left >= -1 && b.right <= innerWidth + 1;
});
if (menuFits === false) note("Model menu overflows the viewport at 420px");
await page.keyboard.press("Escape");

/* ---- 15. New chat ------------------------------------------------------- */
step(15, "new chat resets to welcome, history survives");
await page.setViewportSize({ width: 1440, height: 980 });
await page.waitForTimeout(400);
await page.click(".rail__new");
await page.waitForTimeout(700);
await shot("15-reset");

const reset = await page.evaluate(() => ({
  welcome: !!document.querySelector(".welcome"),
  history: document.querySelectorAll('.history__row[data-kind="live"]').length,
}));
if (!reset.welcome) note("New chat did not return to the welcome state");
if (reset.history !== 1) note("New chat lost the previous conversation from the sidebar");

/* ---- 16. Reload --------------------------------------------------------- */
step(16, "transcript survives reload, agent session does not");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".window");
await page.waitForTimeout(900);

const restored = await page.locator('.history__row[data-kind="live"]').count();
if (restored !== 1) note(`Transcript did not survive reload (${restored} items)`);
await page.click('.history__row[data-kind="live"] .history__item');
await page.waitForTimeout(900);
await shot("16-restored");

const after = await page.evaluate(() => ({
  messages: document.querySelectorAll(".msg").length,
  banner: document.querySelector(".banner")?.textContent?.slice(0, 48) ?? null,
}));
if (after.messages < 2) note("Reopened conversation lost its messages");
console.log("  ", JSON.stringify(after));

/* ---- 17. Prompt library: save and remove -------------------------------- */
/* Here rather than earlier because it needs a conversation with a message in
   it, and every step before 16 counts live chats exactly. /save keeps the
   last thing the user sent, /prompt must then offer it, and /unsave must take
   it away again — from the list AND from storage, or it would be back after
   the next reload. */
step(17, "/save keeps the last message, /prompt offers it, /unsave removes it");
const storedPrompts = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("cortex.prompts.v1") ?? "[]");
    } catch {
      return null;
    }
  });
const promptRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".palette__row")].map((r) => ({
      name: r.querySelector(".palette__name")?.textContent,
      hint: r.querySelector(".palette__hint")?.textContent,
    })),
  );
const noticeText = () =>
  page.evaluate(() =>
    document.querySelector('.composer__hint[data-notice="true"]')?.textContent?.trim() ?? null,
  );

await page.click(".composer__field");
await page.fill(".composer__field", "/save");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const saveStage = await page.evaluate(() => ({
  draft: document.querySelector(".composer__field")?.value,
  label: document.querySelector('.palette__row[data-active="true"] .palette__name')?.textContent,
}));
await shot("17-save");
const savedName = /^Save as “(.+)”$/.exec(saveStage.label ?? "")?.[1] ?? null;
if (saveStage.draft !== "/save ") note(`Enter on /save did not advance (draft "${saveStage.draft}")`);
if (!savedName) note(`/save offered "${saveStage.label}" instead of a name to save under`);

await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const saved = {
  notice: await noticeText(),
  draft: await page.inputValue(".composer__field"),
  stored: await storedPrompts(),
};
if (!saved.notice?.startsWith("Saved")) note(`/save gave no confirmation (hint: "${saved.notice}")`);
if (saved.draft !== "") note("/save left text in the box");
if (saved.stored?.length !== 1 || saved.stored[0].name !== savedName)
  note(`Storage holds ${JSON.stringify(saved.stored)} after /save`);
else if (saved.stored[0].text !== PROMPT)
  note("/save stored something other than the last message sent");

await page.fill(".composer__field", "/prompt ");
await page.waitForTimeout(400);
const withSaved = await promptRows();
if (!withSaved.some((r) => r.name === savedName && r.hint === "Saved"))
  note(`"${savedName}" is not offered by /prompt after saving it`);

await page.fill(".composer__field", "/unsave ");
await page.waitForTimeout(400);
const unsaveRows = await promptRows();
if (unsaveRows.length !== 1 || unsaveRows[0].name !== savedName)
  note(`/unsave offered ${JSON.stringify(unsaveRows)}`);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const removed = { notice: await noticeText(), stored: await storedPrompts() };
if (!removed.notice?.startsWith("Removed")) note(`/unsave gave no confirmation ("${removed.notice}")`);
if (removed.stored?.length !== 0) note("/unsave left the prompt in storage");

await page.fill(".composer__field", "/prompt ");
await page.waitForTimeout(400);
const afterUnsave = await promptRows();
if (afterUnsave.some((r) => r.name === savedName)) note("/prompt still offers a removed prompt");
console.log(
  "  ",
  JSON.stringify({ savedName, saved: saved.notice, offered: withSaved.length, removed: removed.notice }),
);
await page.fill(".composer__field", "");

/* ---- 18. Code blocks ---------------------------------------------------- */
/* The simulator's debounce reply is the only fenced block it has, and the
   live agent cannot be relied on to produce one, so this is simulator-only.
   It is caught twice: mid-stream, where the fence is still open and Copy
   must hold off, and settled, where Copy must hand over exactly the code. */
if (!live) {
  step(18, "code block: language, highlighting, copy");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new globalThis.URL(base).origin,
  });
  await page.click(".rail__new");
  await page.waitForTimeout(600);
  await page.click(".composer__field");
  await page.fill(".composer__field", "Show me a code snippet that debounces a function");
  await page.click(".send");

  await page
    .waitForSelector(".codeblock", { timeout: 15000 })
    .catch(() => note("No code block appeared while the reply streamed"));
  const midStream = await page.evaluate(() => {
    const b = document.querySelector(".codeblock");
    return {
      open: b?.dataset.open === "true",
      copyDisabled: b?.querySelector(".codeblock__copy")?.disabled ?? null,
    };
  });
  /* Timing decides whether the fence is still open when we look, so only a
     block that IS open is held to the open-block rules. */
  if (midStream.open && !midStream.copyDisabled) note("Copy was offered on a half-written block");

  await page
    .waitForSelector('[aria-label="Stop generating"]', { state: "detached", timeout: 30000 })
    .catch(() => note("Code reply never finished"));
  await page.waitForTimeout(500);
  await page.locator(".msg--assistant .codeblock").first().scrollIntoViewIfNeeded();
  await shot("18-code-block");

  const code = await page.evaluate(() => {
    const block = document.querySelector(".msg--assistant .codeblock");
    if (!block) return null;
    const pre = block.querySelector(".codeblock__pre");
    const count = (k) => block.querySelectorAll(`.tok--${k}`).length;
    const kw = block.querySelector(".tok--keyword");
    return {
      lang: block.querySelector(".codeblock__lang")?.textContent ?? null,
      open: block.dataset.open ?? null,
      copy: block.querySelector(".codeblock__copy")?.getAttribute("aria-label") ?? null,
      keyword: count("keyword"),
      string: count("string"),
      number: count("number"),
      comment: count("comment"),
      /* A token class with no colour behind it is highlighting in name only. */
      tinted: !!kw && getComputedStyle(kw).color !== getComputedStyle(pre).color,
      overflowX: getComputedStyle(pre).overflowX,
      text: pre.textContent,
    };
  });
  if (!code) note("The code reply rendered no code block");
  else {
    if (code.lang !== "TypeScript") note(`Code block is labelled "${code.lang}", expected TypeScript`);
    if (code.open) note("Code block still marked as being written after the reply finished");
    if (code.copy !== "Copy code") note(`Copy button is labelled "${code.copy}"`);
    for (const k of ["keyword", "string", "number", "comment"])
      if (!code[k]) note(`No ${k} tokens were highlighted`);
    if (!code.tinted) note("Keyword tokens are the same colour as plain code");
    if (code.overflowX !== "auto") note(`Code block overflow-x is "${code.overflowX}", not auto`);

    await page.click(".msg--assistant .codeblock__copy");
    await page.waitForTimeout(250);
    const copied = await page.evaluate(async () => ({
      label: document.querySelector(".msg--assistant .codeblock__copy")?.getAttribute("aria-label"),
      clip: await navigator.clipboard.readText().catch(() => null),
    }));
    if (copied.label !== "Copied") note(`Copy did not confirm (label "${copied.label}")`);
    /* The Windows clipboard hands text back with CRLF line endings whatever
       went in, so compare lines, not bytes. */
    if (copied.clip?.replace(/\r\n/g, "\n") !== code.text)
      note("Clipboard does not hold exactly the block's code");
    await page.waitForTimeout(1600);
    const reverted = await page.evaluate(() =>
      document.querySelector(".msg--assistant .codeblock__copy")?.getAttribute("aria-label"),
    );
    if (reverted !== "Copy code") note(`Copy label stuck on "${reverted}" after 1.5s`);
    console.log("  ", JSON.stringify({ midStream, ...code, text: undefined, copied: copied.label, reverted }));
  }

  /* The block's longest lines are wider than a phone. They must scroll inside
     the block, never push the page sideways. */
  await page.setViewportSize({ width: 420, height: 880 });
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => {
    const pre = document.querySelector(".msg--assistant .codeblock__pre");
    const block = pre?.closest(".codeblock")?.getBoundingClientRect();
    return {
      scrolls: !!pre && pre.scrollWidth > pre.clientWidth,
      inside: !!block && block.right <= innerWidth + 1 && block.left >= -1,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  await page.locator(".msg--assistant .codeblock").first().scrollIntoViewIfNeeded();
  await shot("18-code-block-mobile");
  if (!narrow.scrolls) note("Long code lines do not scroll inside the block at 420px");
  if (!narrow.inside) note("Code block spills out of the viewport at 420px");
  if (narrow.pageOverflow) note("A code block makes the page scroll sideways at 420px");
  console.log("  ", JSON.stringify(narrow));
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.waitForTimeout(400);

  /* ---- 19. Own-key model on the status card ------------------------------ */
  /* Last, because it leaves the session on a model the rest of the run does
     not expect. A model on the user's own key draws nothing from the Copilot
     allowance, so the bar has to give way to a line that says so. */
  step(19, "own-key model replaces the allowance bar");
  await page.click(".modelpill");
  await page.waitForTimeout(500);
  await page.locator(".pop__item", { hasText: "Llama 3.2 (Ollama)" }).first().click();
  await page.waitForTimeout(800);
  const own = await page.evaluate(() => ({
    kind: document.querySelector(".budget")?.getAttribute("data-kind") ?? null,
    text: document.querySelector(".budget__text > span:first-child")?.textContent ?? null,
    bar: !!document.querySelector(".budget__bar"),
    model: document.querySelector(".status__modelname")?.textContent ?? null,
    pill: document.querySelector(".modelpill__effort")?.textContent ?? null,
  }));
  await shot("19-own-model");
  if (own.kind !== "own") note(`Allowance kind is "${own.kind}" on an own-key model`);
  if (own.text !== "Own model · openai") note(`Allowance reads "${own.text}" on an own-key model`);
  if (own.bar) note("Allowance bar is still drawn for a model not billed to Copilot");
  if (own.pill) note(`Own-key model shows effort "${own.pill}", but it takes none`);
  console.log("  ", JSON.stringify(own));
}

/* ---- Report ------------------------------------------------------------- */
console.log("\n==================== RESULT ====================");
console.log("console errors:", consoleErrors.length ? consoleErrors : "(none)");
console.log("problems:", problems.length ? problems : "(none)");
console.log("================================================");

await browser.close();
process.exit(problems.length || consoleErrors.length ? 1 : 0);
