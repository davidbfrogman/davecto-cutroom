import { describe, expect, it } from "vitest";
import * as textMod from "../shared/text.mjs";
import * as planMod from "../shared/plan.mjs";
import * as timelineMod from "../shared/timeline.mjs";
import * as framingMod from "../shared/framing.mjs";
import * as brandMod from "../shared/brand.mjs";

const { cleanWords, titleFrom } = textMod as any;
const { plan, isRetake, inSentenceCuts, findStat, withDefaults } = planMod as any;
const { buildTimeline, shotRanges, outputSize, chunkCaptions } = timelineMod as any;
const { cropRect } = framingMod as any;
const { resolveBrand, fontRef, pickBrand } = brandMod as any;

type W = { i: number; text: string; start: number; end: number; p?: number };

/** Words from a script: "a b c. | d e" — "|" is a 1.2s pause, otherwise 0.1s between words. */
function words(script: string): W[] {
  const out: Omit<W, "i">[] = [];
  let t = 0;
  for (const raw of script.split(/\s+/).filter(Boolean)) {
    if (raw === "|") { t += 1.2; continue; }
    out.push({ text: ` ${raw}`, start: t, end: t + 0.3, p: 1 }); // Whisper words start with a space
    t += 0.4;
  }
  return cleanWords(out);
}

describe("cutroom text", () => {
  it("glues punctuation-only tokens to the word before", () => {
    const w = cleanWords([{ text: " 70", start: 1, end: 1.2 }, { text: "%", start: 1.2, end: 1.3 }, { text: " of", start: 1.4, end: 1.5 }]);
    expect(w.map((x: W) => x.text)).toEqual(["70%", "of"]);
    expect(w[1].i).toBe(1);
  });

  it("re-joins numbers and hyphenated words Whisper splits", () => {
    const w = cleanWords([{ text: " has", start: 0, end: 0.2 }, { text: " 160", start: 0.2, end: 0.4 }, { text: ",000", start: 0.4, end: 0.6 },
      { text: " over", start: 0.7, end: 0.8 }, { text: "-engineering", start: 0.8, end: 1 }]);
    expect(w.map((x: W) => x.text)).toEqual(["has", "160,000", "over-engineering"]);
  });

  it("makes short titles from spoken list items", () => {
    expect(titleFrom("First, sell before you build.")).toBe("Sell before you build");
    expect(titleFrom("Second, talk to the people who already complain about the problem.")).toBe("Talk to the people");
    expect(titleFrom("Number three: charge from day one.")).toBe("Charge from day one");
  });
});

describe("cutroom planner", () => {
  it("spots an abandoned take and keeps the later one", () => {
    const w = words("Here are three ways to get, um. | Here are three ways to get your first customer.");
    expect(isRetake([0, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13, 14, 15], w)).toBe(true);
  });

  it("leaves parallel sentences alone", () => {
    const w = words("I want to show you pricing. I want to show you sales.");
    expect(isRetake([0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], w)).toBe(false);
  });

  it("cuts fillers, stutters and repeated phrases inside a sentence", () => {
    const w = words("So um I I think the offer the offer matters.");
    const cut = inSentenceCuts(w.map(x => x.i), w, { fillers: true, repeats: true });
    expect(cut).toEqual({ 1: "filler", 2: "repeat", 5: "repeat", 6: "repeat" });
  });

  it("finds stats worth a callout, not every number", () => {
    const a = words("We saw 70% of free users never come back.");
    expect(findStat(a.map(x => x.i), a)).toMatchObject({ value: "70%", label: "of free users never come back" });
    const b = words("Send it to 10 people.");
    expect(findStat(b.map(x => x.i), b)).toBeNull();
  });

  it("builds sections for a list, a wrap-up and a call to action", () => {
    const w = words(
      "Most founders build for months. | Here are three ways to fix it. | First, sell before you build. | Second, talk to customers. | Third, charge from day one. | So pick one today. | Comment LAB and I'll send it.",
    );
    const sb = plan(w, { settings: { brand: { name: "Sam Lee", role: "Founder" } } });
    expect(sb.sections.map((s: any) => s.kind)).toEqual(["hook", "item", "item", "item", "wrap", "cta"]);
    expect(sb.sections[1].title).toBe("Sell before you build");
    const overlays = sb.shots.flatMap((s: any) => s.overlays.map((o: any) => o.type));
    expect(overlays).toEqual(expect.arrayContaining(["headline", "lowerThird", "chapter", "cta"]));
    const cta = sb.shots.flatMap((s: any) => s.overlays).find((o: any) => o.type === "cta");
    expect(cta.text).toBe("Comment LAB.");
  });

  it("puts the name lower third where the speaker introduces themself", () => {
    const w = words("This plugin has 160,000 stars. | It cut code by 53%. | By the way, I'm Sam, I build software. | Here is what I found.");
    const sb = plan(w, { settings: { brand: { name: "Sam Lee", role: "Founder" } } });
    const lt = sb.shots.findIndex((s: any) => s.overlays.some((o: any) => o.type === "lowerThird"));
    expect(lt).toBe(2);
    expect(sb.shots[0].overlays.map((o: any) => o.type)).toEqual(["headline"]);
  });

  it("drops a throat-clearing opener but keeps it in the storyboard", () => {
    const w = words("Hey guys, welcome back. | Pricing is a decision. | Here is how to make it. | Start high.");
    const sb = plan(w, { settings: {} });
    expect(sb.shots[0].enabled).toBe(false);
    expect(sb.shots[0].flag.type).toBe("intro");
  });
});

describe("cutroom timeline", () => {
  const w = words("One two three. | Four five six.");
  const project = (shots: object[], settings = {}) => ({
    settings: withDefaults({ captions: { on: true }, ...settings }),
    source: { duration: 10 },
    storyboard: { sections: [{ id: "a", title: "A" }], shots },
  });

  it("cuts long pauses out of a shot", () => {
    const ranges = shotRanges({ kind: "talk", w0: 0, w1: 5, cut: {} }, w, null, { minGap: 0.4 }, 10);
    expect(ranges).toHaveLength(2);
    expect(ranges[0][1]).toBeLessThan(w[3].start);
  });

  it("keeps cut words out of the ranges", () => {
    const ranges = shotRanges({ kind: "talk", w0: 0, w1: 2, cut: { 1: "user" } }, w, null, {}, 10);
    expect(ranges).toHaveLength(2);
    expect(ranges[0][1]).toBeLessThanOrEqual(w[1].start);
    expect(ranges[1][0]).toBeGreaterThanOrEqual(w[1].end);
  });

  it("overlaps shots by the transition length, in whole frames", () => {
    const tl = buildTimeline(project([
      { id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {} },
      { id: "s2", kind: "talk", section: "a", w0: 3, w1: 5, cut: {}, transition: { type: "fade", duration: 0.3 } },
    ]), { words: w, envelope: null });
    const [a, b] = tl.items;
    expect(b.trans).toEqual({ type: "fade", d: 0.3 });
    expect(b.start).toBeCloseTo(a.dur - 0.3, 6);
    expect(tl.duration).toBeCloseTo(a.dur + b.dur - 0.3, 6);
    for (const it of tl.items) expect(Math.abs(it.dur * 30 - Math.round(it.dur * 30))).toBeLessThan(1e-6);
  });

  it("places words and captions on the output clock, skipping switched-off shots", () => {
    const tl = buildTimeline(project([
      { id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {}, enabled: false },
      { id: "s2", kind: "talk", section: "a", w0: 3, w1: 5, cut: {} },
    ]), { words: w, envelope: null });
    expect(tl.words[0].text).toBe("Four");
    expect(tl.words[0].t0).toBeLessThan(0.2);
    expect(tl.captions[0].words.map((x: any) => x.text).join(" ")).toBe("Four five six.");
  });

  it("breaks captions at sentence ends", () => {
    const placed = ["Charge", "day", "one.", "We", "saw"].map((text, i) => ({ i, text, t0: i * 0.3, t1: i * 0.3 + 0.25, item: "x", filler: false }));
    const c = chunkCaptions(placed, [], {}, true);
    expect(c.map((x: any) => x.words.map((w: any) => w.text).join(" "))).toEqual(["Charge day one.", "We saw"]);
  });

  it("sizes outputs and crops the same way in preview and render", () => {
    expect(outputSize("9:16", 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("16:9", 1080)).toEqual({ width: 1920, height: 1080 });
    const r = cropRect(1920, 1080, 1080, 1920, 1, 0.5, 0.5);
    expect(r.h).toBe(1080);
    expect(r.w).toBeCloseTo(607.5, 3);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2, 3);
  });
});

describe("cutroom edit ops (what Claude sends)", () => {
  const opsMod = import("../shared/ops.mjs");
  const w = words("By the way I'm Sam. | Here is the plan for today.");
  const base = (): any => ({
    settings: withDefaults({}),
    storyboard: {
      sections: [{ id: "a", title: "A" }],
      shots: [
        { id: "s1", kind: "talk", section: "a", w0: 0, w1: 4, cut: {}, overlays: [] },
        { id: "s2", kind: "talk", section: "a", w0: 5, w1: 10, cut: {}, overlays: [] },
      ],
    },
  });

  it("cuts by phrase, and restores", async () => {
    const { applyOps } = (await opsMod) as any;
    const r = applyOps(base(), [{ op: "cut", shot: "s1", phrase: "by the way" }], w);
    expect(r.project.storyboard.shots[0].cut).toEqual({ 0: "claude", 1: "claude", 2: "claude" });
    expect(r.changed).toEqual(["s1"]);
    const back = applyOps(r.project, [{ op: "cut", shot: "s1", phrase: "the way", restore: true }], w);
    expect(back.project.storyboard.shots[0].cut).toEqual({ 0: "claude" });
  });

  it("is all or nothing, and names the failing op", async () => {
    const { applyOps } = (await opsMod) as any;
    const p = base();
    expect(() => applyOps(p, [{ op: "shot", id: "s1", set: { zoom: 1.2 } }, { op: "cut", shot: "s2", phrase: "not there" }], w)).toThrow(/Op 2 \(cut\)/);
    expect(p.storyboard.shots[0].zoom).toBeUndefined();
  });

  it("adds an animation pinned to a phrase, splits and moves shots", async () => {
    const { applyOps } = (await opsMod) as any;
    const r = applyOps(base(), [
      { op: "overlay_add", shot: "s2", overlay: { type: "motion", name: "kinetic-title", vars: { text: "The plan" }, phrase: "the plan" } },
      { op: "split", shot: "s2", phrase: "for today" },
      { op: "move", shot: "s1", after: "s2" },
    ], w);
    const shots = r.project.storyboard.shots;
    expect(shots.map((s: any) => s.id)[0]).toBe("s2");
    expect(shots[0].overlays[0]).toMatchObject({ type: "motion", name: "kinetic-title", word: 7 });
    expect(shots[0].w1).toBe(8);
    expect(shots.map((s: any) => s.id).slice(0, 2)).toEqual(["s2", "s1"]);
    expect(shots[2].w0).toBe(9);
  });

  it("refuses unknown fields and overlay types", async () => {
    const { applyOps } = (await opsMod) as any;
    expect(() => applyOps(base(), [{ op: "shot", id: "s1", set: { w0: 3 } }], w)).toThrow(/Can't set "w0"/);
    expect(() => applyOps(base(), [{ op: "overlay_add", shot: "s1", overlay: { type: "confetti" } }], w)).toThrow(/Unknown overlay type/);
  });
});

describe("cutroom animations in the timeline", () => {
  const p = (shots: object[]) => ({ settings: withDefaults({ captions: { on: false } }), source: { duration: 10 }, storyboard: { sections: [{ id: "a", title: "A" }], shots } });
  const w = words("One two three. | Four five six.");

  it("centres a stinger's cover point on the cut, on the top layer", () => {
    const tl = buildTimeline(p([
      { id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {} },
      { id: "s2", kind: "talk", section: "a", w0: 3, w1: 5, cut: {}, transition: { type: "cut", stinger: { name: "stinger-wipe", dur: 1, cut: 0.5 } } },
    ]), { words: w, envelope: null });
    const st = tl.overlays.find((o: any) => o.id === "s2-stinger");
    expect(st.start + 0.5).toBeCloseTo(tl.items[1].start, 6);
    expect(st.props.top).toBe(true);
  });

  it("keeps animations out of the Cutaways graphics page", async () => {
    const { overlayData } = (await import("../shared/timeline.mjs")) as any;
    const tl = buildTimeline(p([{ id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {}, overlays: [{ id: "m", type: "motion", name: "x", dur: 2 }, { id: "k", type: "keyword", text: "Hi", dur: 1 }] }]), { words: w, envelope: null });
    expect(tl.overlays.map((o: any) => o.type).sort()).toEqual(["keyword", "motion"]);
    expect(overlayData(tl, {}).overlays.map((o: any) => o.type)).toEqual(["keyword"]);
  });

  it("cuts the speaker out only where an animation sits behind them, and never on cards", async () => {
    const { cutouts } = (await import("../shared/timeline.mjs")) as any;
    const tl = buildTimeline(p([
      { id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {}, overlays: [{ id: "front", type: "motion", name: "x", dur: 0.5 }, { id: "back", type: "motion", name: "x", at: 0.2, dur: 30, behind: true }] },
      { id: "c1", kind: "card", section: "a", card: { title: "Card", dur: 1 } },
      { id: "s2", kind: "talk", section: "a", w0: 3, w1: 5, cut: {}, transition: { type: "cut", stinger: { name: "stinger-wipe", dur: 1, behind: true } } },
    ]), { words: w, envelope: null });
    const c = cutouts(tl);
    expect(c.windows.map((x: any) => x.id)).toEqual(["back"]);
    // Runs to the end of the edit: covers the card and s2, but the card has nobody to cut out.
    expect(c.items).toEqual(["s1", "s2"]);
    // Once the animation's real length is known, a shorter one doesn't reach the later shots.
    const short = cutouts(tl, new Map([["back", tl.items[0].start + 0.5]]));
    expect(short.items).toEqual(["s1"]);
    expect(cutouts(buildTimeline(p([{ id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {} }]), { words: w, envelope: null })).windows).toEqual([]);
  });

  it("lets only animations sit behind the speaker", async () => {
    const { applyOps } = (await import("../shared/ops.mjs")) as any;
    const base = () => ({ settings: withDefaults({}), storyboard: { sections: [{ id: "a", title: "A" }], shots: [{ id: "s1", kind: "talk", section: "a", w0: 0, w1: 2, cut: {}, overlays: [{ id: "o1", type: "motion", name: "x" }, { id: "o2", type: "keyword", text: "Hi" }] }] } });
    const r = applyOps(base(), [{ op: "overlay_update", id: "o1", set: { behind: true } }], w);
    expect(r.project.storyboard.shots[0].overlays[0].behind).toBe(true);
    expect(() => applyOps(base(), [{ op: "overlay_update", id: "o2", set: { behind: true } }], w)).toThrow(/Only animations/);
    expect(() => applyOps(base(), [{ op: "overlay_add", shot: "s1", overlay: { type: "headline", text: "Hi", behind: true } }], w)).toThrow(/Only animations/);
  });
});

describe("cutroom brand", () => {
  it("adds no lower third until the user has a name", () => {
    const w = words("Most founders build for months. | By the way, I'm Sam, I build software. | Here is what I found.");
    const sb = plan(w, { settings: {} });
    expect(sb.shots.some((s: any) => s.overlays.some((o: any) => o.type === "lowerThird"))).toBe(false);
  });

  it("fills blank colours from the theme and keeps the user's", () => {
    const b = resolveBrand(withDefaults({ theme: "light", brand: { accent: "#FF5A1F", plate: "nope" } }));
    expect(b.colors).toEqual({ plate: "#f7f5f0", text: "#181614", accent: "#ff5a1f" });
    expect(b.custom).toEqual({ plate: false, text: false, accent: true });
    expect(b.display).toMatch(/^"Fraunces"/);
    expect(b.body).toMatch(/^"Inter"/);
  });

  it("resolves the user's own fonts and refuses paths", () => {
    expect(fontRef("user/Advercase-Regular.otf")).toMatchObject({ family: "CR Advercase-Regular", scope: "user", url: "/userfonts/Advercase-Regular.otf" });
    expect(fontRef("user/../secret.otf")).toBeNull();
    expect(fontRef("user/.hidden.otf")).toBeNull();
    expect(fontRef("user/notes.txt")).toBeNull();
    expect(fontRef("nope")).toBeNull();
  });

  it("gives captions their own font and size", () => {
    const serif = resolveBrand(withDefaults({ captions: { font: "serif", size: 1.2 } }));
    expect(serif.caption.serif).toBe(true);
    expect(serif.caption.scale).toBeCloseTo(1.4 * 1.2);
    const own = resolveBrand(withDefaults({ captions: { font: "user/Advercase-Regular.otf" } }));
    expect(own.caption.stack).toMatch(/^"CR Advercase-Regular"/);
    expect(own.fonts.map((f: any) => f.id)).toContain("user/Advercase-Regular.otf");
    expect(resolveBrand(withDefaults({})).caption.stack).toBeNull();
  });

  it("saves the look and brand as a default, not the edit", () => {
    const d = pickBrand(withDefaults({ theme: "light", brand: { name: "Sam Lee", accent: "#ff5a1f" }, aspect: "16:9" }));
    expect(d.theme).toBe("light");
    expect(d.brand.name).toBe("Sam Lee");
    expect(d).not.toHaveProperty("aspect");
  });
});
