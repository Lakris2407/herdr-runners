// The chip's popup: what waits, what runs, each machine's load; buttons to the panel and the timeline.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, run, closeOverlay } from "herdr";
import { snapshot, refresh } from "./poll.js";
import { waiting, running, duration, ago, summary } from "./model.js";
import { jobRow, groupTitle, loadBar, loadText, button, colors, runTime, openLanes } from "./ui.js";

const MAX = 6;

export function machineRow(m, t) {
  const busy = m.runners.filter((r) => r.job).length, off = m.runners.some((r) => r.status === "offline");
  const c = colors(t);
  return h_flex().gap(10).px(6).py(2).items_center().text_size(11).text_color(t.muted)
    .child(div().size(7).rounded(4).bg(off ? c.off : m.loadError ? t.border : c.ok))
    .child(div().flex_1().min_w(0).truncate().child(`${m.name} · ${busy} of ${m.runners.length} busy`))
    .child(loadBar(m, t))
    .child(div().w(108).text_right().truncate().child(loadText(m)));
}

export class Popup {
  init() {}

  close() {
    closeOverlay(props()?.overlay);
  }

  render() {
    const t = theme(), s = snapshot(), now = Date.now();
    const root = v_flex().id("runners-popup").size_full().bg(t.popover).text_color(t.foreground).text_size(12);
    const head = h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(13).child("Runners"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(s ? `updated ${ago(s.at, now)}` : "loading…"))
      .child(button("pop-refresh", "Refresh", t, () => refresh()));
    if (!s) return root.child(head);
    const w = waiting(s), r = running(s), sum = summary(s), c = colors(t);
    const group = (id, title, right, rows) => v_flex().id(id).gap(2).px(6).py(8).border_b(1).border_color(t.border)
      .child(groupTitle(title, right, t)).children(rows);
    const more = (list) => (list.length > MAX ? [div().px(6).text_size(11).text_color(t.dim).child(`and ${list.length - MAX} more in the panel`)] : []);
    return root.child(head)
      // A popup sizes to its content: the body gets a cap, not flex, or it collapses to nothing.
      .child(v_flex().id("pop-body").max_h(520).overflow_y_scrollbar()
        .when(Boolean(s.error), (e) => e.child(div().px(12).py(6).text_size(11).text_color(c.off).child(s.error)))
        .child(group("pop-wait", `Waiting · ${w.length}`, w.length ? `longest ${duration(sum.longest)}` : "nothing waits",
          [...w.slice(0, MAX).map((j) => jobRow(`pw-${j.id}`, j, { right: duration(now - j.created), rightColor: c.wait, sub: `${j.branch} · needs ${j.labels.join(", ")}` }, t)), ...more(w)]))
        .child(group("pop-run", `Running · ${r.length}`, `${sum.busy} of ${sum.total} slots`,
          [...r.slice(0, MAX).map((j) => jobRow(`pr-${j.id}`, j, { right: runTime(j, s.typical, now), sub: `${j.branch} · ${j.runner}`, typical: s.typical, now }, t)), ...more(r)]))
        .child(group("pop-mach", "Machines", "load / cores", s.machines.map((m) => machineRow(m, t)))))
      .child(h_flex().h(40).flex_none().px(12).gap(6).items_center().justify_end()
        .child(button("pop-panel", "Open panel", t, () => {
          run("layout.select", { stack: "panel-body", child: "runners" });
          run("layout.show", { id: "panel" });
          this.close();
        }))
        .child(button("pop-lanes", "Timeline", t, () => { openLanes(); this.close(); })));
  }
}
