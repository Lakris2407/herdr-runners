// The right-panel tab: totals, each machine with its slots, what waits, what finished in the last hour.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { snapshot, refresh } from "./poll.js";
import { configPath } from "./config.js";
import { waiting, finished, summary, medianWait, duration, ago, label } from "./model.js";
import { jobRow, loadBar, loadText, button, colors, slotColor, openLanes, openJob, runTime } from "./ui.js";

const FINISHED = 5;

export class Panel {
  init() {}

  tile(value, hint, t, color) {
    return v_flex().flex_1().min_w(0).px(10).py(8).gap(2).rounded(8).border_1().border_color(t.border)
      .child(div().text_size(20).font_semibold().text_color(color ?? t.foreground).child(value))
      .child(div().truncate().text_size(10).text_color(t.dim).child(hint));
  }

  card(title, hint, body, t) {
    return v_flex().gap(6).p(10).rounded(9).border_1().border_color(t.border)
      .child(h_flex().justify_between().items_center()
        .child(div().font_semibold().text_size(12).child(title))
        .child(div().text_size(11).text_color(t.dim).child(hint)))
      .child(body);
  }

  // One machine: its load, then a bar per slot naming the job it runs.
  machine(m, s, t, now) {
    const c = colors(t), off = m.runners.some((r) => r.status === "offline");
    const p = m.load != null && m.cores ? m.load / m.cores : 0;
    const jobs = new Map(s.jobs.map((j) => [j.id, j]));
    return v_flex().id(`m-${m.name}`).flex_1().flex_basis(150).min_w(150).gap(6).p(8).rounded(8).border_1()
      .border_color(p >= 0.9 ? c.hot : t.border)
      .child(h_flex().gap(6).items_center().child(div().size(7).rounded(4).bg(off ? c.off : m.loadError ? t.border : c.ok))
        .child(div().truncate().font_semibold().child(m.name)))
      .when(Boolean(m.ssh), (e) => e.child(h_flex().gap(6).items_center().text_size(10).text_color(p >= 0.9 ? c.hot : t.dim)
        .child(loadBar(m, t, 56)).child(div().truncate().child(loadText(m)))))
      .when(Boolean(m.warm) && m.warm !== "none", (e) => e.child(div().truncate().text_size(10).text_color(t.dim).child(`warm: ${m.warm}`)))
      .child(v_flex().gap(3).children(m.runners.map((r) => {
        const j = r.job ? jobs.get(r.job) : null;
        const text = j ? `${j.short} ${label(j)} · ${j.branch}` : r.status === "offline" ? "offline" : r.status === "unknown" ? "idle?" : "free";
        return h_flex().id(`slot-${r.name}`).gap(6).items_center().text_size(10)
          .when(Boolean(j), (e) => e.cursor_pointer().on_click(() => openJob(j)).tooltip(`${label(j)} · ${j.branch} · ${runTime(j, s.typical, now)}`))
          .when(!j, (e) => e.tooltip(r.status === "unknown" ? `${r.name}: no status (GitHub needs repo admin to list it)` : `${r.name} · ${r.status === "online" ? "free" : r.status}`))
          .child(div().w(58).flex_none().truncate().text_color(t.dim).child(r.label ?? r.name))
          .child(div().flex_1().min_w(0).h(15).px(4).rounded(3).bg(slotColor(r, t)).truncate().text_size(9)
            .text_color(j ? t.accent_foreground : t.dim).child(text));
      })));
  }

  body(s, t, now) {
    const sum = summary(s), w = waiting(s), f = finished(s, now, 3600000), c = colors(t), mw = medianWait(s, now);
    const result = (j) => j.conclusion === "success" ? ["✓", c.ok] : j.conclusion === "cancelled" ? ["–", t.dim] : ["✕", c.off];
    return v_flex().gap(8)
      .child(h_flex().gap(6)
        .child(this.tile(String(sum.waiting), sum.waiting ? `waiting · ${duration(sum.longest)}` : "waiting", t, sum.waiting ? c.wait : null))
        .child(this.tile(`${sum.busy}/${sum.total}`, "slots busy", t))
        .child(this.tile(mw == null ? "—" : duration(mw), "wait today", t)))
      .child(h_flex().flex_wrap().gap(6).children(s.machines.map((m) => this.machine(m, s, t, now))))
      .child(this.card("Waiting", w.length ? "oldest first" : "nothing waits", v_flex().gap(1).children(
        w.map((j) => jobRow(`w-${j.id}`, j, { right: duration(now - j.created), rightColor: c.wait, sub: `${j.branch} · ${j.labels.join(", ")}` }, t))), t))
      .child(this.card("Finished", f.length ? `${f.length} in the last hour` : "last hour", v_flex().gap(1)
        .when(!f.length, (e) => e.child(div().px(6).text_size(11).text_color(t.dim).child("No watched jobs finished in the last hour.")))
        .children(f.slice(0, this.showAll ? f.length : FINISHED).map((j) => {
          const [mark, color] = result(j);
          return jobRow(`f-${j.id}`, j, { right: `${mark} ${ago(j.completed, now)}`, rightColor: color, sub: `${j.branch} · ${j.runner ?? "?"} · ran ${duration(j.completed - j.started)}${j.started - j.created > 60000 ? ` · waited ${duration(j.started - j.created)}` : ""}` }, t);
        }))
        .when(f.length > FINISHED, (e) => e.child(div().id("f-more").px(6).pt(4).cursor_pointer().text_size(11).text_color(t.accent)
          .on_click((_e, cx) => { this.showAll = !this.showAll; cx.notify(); })
          .child(this.showAll ? "Show fewer" : `Show ${f.length - FINISHED} more`))), t));
  }

  render() {
    const t = theme(), s = snapshot(), now = Date.now();
    return v_flex().id("runners").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(h_flex().h(42).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Runners"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(s ? `updated ${ago(s.at, now)}` : "Loading…"))
        .child(button("runners-lanes", "Timeline", t, () => openLanes()))
        .child(button("runners-refresh", "Refresh", t, () => refresh())))
      .child(v_flex().id("runners-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
        .when(Boolean(s?.error), (e) => e.child(div().text_size(11).text_color(colors(t).off).child(s.error)))
        .when(!s, (e) => e.child(div().p(4).text_color(t.dim).child("Reading the runners…")))
        .when(Boolean(s?.missing), (e) => e.child(this.card("Set up", "", v_flex().gap(4).text_size(11).text_color(t.muted)
          .child(`Create ${configPath()} with your repos and machines.`)
          .child("See the README for every field, or try it with { \"demo\": true }."), t)))
        .when(Boolean(s), (e) => e.child(this.body(s, t, now))));
  }
}
