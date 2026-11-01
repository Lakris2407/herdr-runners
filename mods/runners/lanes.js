// The timeline window: a lane per runner slot over the last 30 minutes and the next 10.
// Finished and running jobs sit where they ran; waiting jobs sit where the next free slot of their pool
// should take them, from how long each job usually takes.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay, settings } from "herdr";
import { snapshot } from "./poll.js";
import { slots, plan, jobKey, label, duration, ago } from "./model.js";
import { colors, button, openJob } from "./ui.js";

const MIN = 60000, BACK = 30 * MIN, AHEAD = 10 * MIN, SPAN = BACK + AHEAD;
const NAME_W = 130, PAD = 16, LANE_H = 24;

export class Lanes {
  init() { this.width = 940; }

  render() {
    const t = theme(), s = snapshot(), now = Date.now(), c = colors(t);
    const root = v_flex().id("lanes").size_full().bg(t.popover).text_color(t.foreground).text_size(11)
      // Sizes arrive in screen pixels; the layout works in zoomed units.
      .on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (w !== this.width) { this.width = w; cx.notify(); } });
    const head = h_flex().h(42).flex_none().px(PAD).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(13).child("Runner timeline"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(s ? `last 30 min and next 10 · updated ${ago(s.at, now)}` : "loading…"))
      .child(div().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(button("lanes-close", "Close", t, () => closeOverlay(props()?.overlay))));
    if (!s) return root.child(head);

    const W = Math.max(200, this.width - 2 * PAD - NAME_W), from = now - BACK;
    const x = (ms) => Math.round(((Math.min(Math.max(ms, from), from + SPAN) - from) / SPAN) * W);
    const { placed, unplaced } = plan(s, now);
    const ticks = [-30, -20, -10, 0, 10];

    // A job's box on a lane, at its place in time; `look` gives it its state's colors.
    const styled = (look) => (id, start, end, text, tip, job) => {
      const left = x(start), w = Math.max(3, x(end) - left);
      return look(div().id(id).absolute().left(left).top(3).w(w).h(LANE_H - 6).px(5).rounded(4).truncate().text_size(10)
        .line_height(`${LANE_H - 8}px`).tooltip(tip)
        .when(Boolean(job), (e) => e.cursor_pointer().on_click(() => openJob(job)))).child(text);
    };
    const done = styled((e) => e.bg(t.surface).border_l(2).border_color(c.ok).text_color(c.ok));
    const fail = styled((e) => e.bg(t.surface).border_l(2).border_color(c.off).text_color(c.off));
    const live = styled((e) => e.bg(c.run).text_color(t.accent_foreground));
    const rest = styled((e) => e.bg(c.run).opacity(0.3));
    const wait = styled((e) => e.border_1().border_dashed().border_color(c.wait).text_color(c.wait));

    const track = (children) => div().relative().w(W).h(LANE_H).rounded(5).bg(t.background)
      .children([...[5, 10, 15, 20, 25, 30, 35].map((m) => div().absolute().left(Math.round((m * MIN / SPAN) * W)).top(0).w(1).h_full().bg(t.surface)),
        ...children, div().absolute().left(x(now)).top(0).w(1).h_full().bg(c.run)]);

    const lane = (r) => {
      const jobs = s.jobs.filter((j) => j.runner === r.name && j.started && (j.completed ?? now) > from);
      const parts = jobs.flatMap((j) => {
        const tip = `${j.short} · ${label(j)} · ${j.branch}`;
        if (j.status === "in_progress") {
          const usual = s.typical[jobKey(j)];
          return [live(`l-${j.id}`, j.started, now, label(j), `${tip} · running ${duration(now - j.started)}`, j),
            ...(usual && j.started + usual > now ? [rest(`r-${j.id}`, now, j.started + usual, "", `usually ${duration(usual)}`, null)] : [])];
        }
        const look = j.conclusion === "success" ? done : j.conclusion === "skipped" ? null : fail;
        return look ? [look(`d-${j.id}`, j.started, j.completed, label(j), `${tip} · ${j.conclusion} · ${duration(j.completed - j.started)}`, j)] : [];
      });
      parts.push(...placed.filter((p) => p.slot === r.name).map((p) =>
        wait(`q-${p.job.id}`, p.start, p.end, `${p.job.short} ${p.job.branch}`, `${p.job.short} · ${label(p.job)} · waiting ${duration(now - p.job.created)} · expected start ${p.start <= now ? "now" : `in ${duration(p.start - now)}`}`, p.job)));
      const dot = r.job ? c.run : r.status === "offline" ? c.off : r.status === "unknown" ? t.border : c.ok;
      return h_flex().id(`lane-${r.name}`).items_center()
        .child(h_flex().w(NAME_W).flex_none().gap(6).items_center().pr(8)
          .child(div().size(7).rounded(4).bg(dot))
          .child(div().truncate().text_color(t.muted).child(r.label ?? r.name))
          .child(div().truncate().text_size(10).text_color(t.dim).child(r.machine)))
        .child(track(parts));
    };

    const axis = h_flex().pl(NAME_W).child(div().relative().w(W).h(14).children(ticks.map((m) => {
      const left = Math.round(((m * MIN + BACK) / SPAN) * W);
      return div().absolute().left(Math.max(0, left - 14)).top(0).text_size(10)
        .text_color(m === 0 ? c.run : t.dim).child(m === 0 ? "now" : `${m > 0 ? "+" : "−"}${Math.abs(m)}m`);
    })));
    const swatch = (look, text) => h_flex().gap(6).items_center().child(look(div().w(14).h(9).rounded(2))).child(text);
    const legend = h_flex().pl(NAME_W).gap(16).flex_wrap().text_color(t.dim)
      .child(swatch((e) => e.bg(t.surface).border_l(2).border_color(c.ok), "passed"))
      .child(swatch((e) => e.bg(t.surface).border_l(2).border_color(c.off), "failed"))
      .child(swatch((e) => e.bg(c.run), "running"))
      .child(swatch((e) => e.bg(c.run).opacity(0.3), "usual rest"))
      .child(swatch((e) => e.border_1().border_dashed().border_color(c.wait), "waiting, at its expected start"));

    return root.child(head).child(v_flex().id("lanes-body").flex_1().min_h(0).overflow_y_scrollbar().px(PAD).py(12).gap(8)
      .child(axis)
      .children(slots(s).map(lane))
      .when(unplaced.length > 0, (e) => e.child(h_flex().pl(NAME_W).gap(6).flex_wrap().text_color(c.wait)
        .child(`No slot has run these yet:`)
        .children(unplaced.map((j) => div().id(`u-${j.id}`).cursor_pointer().on_click(() => openJob(j)).child(`${j.short} ${label(j)}`)))))
      .child(legend));
  }
}
