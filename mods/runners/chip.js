// The status-bar chip: a square per runner slot and what waits. Click: show or hide the Runners panel,
// like the tab bar's button (the popup when the layout has no panel for it). Right-click: the popup.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, openOverlay, layout, run, settings } from "herdr";
import { snapshot } from "./poll.js";
import { slots, summary, waiting, running } from "./model.js";
import { squares, colors } from "./ui.js";

const ROW = 30;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export class Chip {
  init() {}

  open() {
    const s = snapshot();
    const rows = s ? Math.min(6, waiting(s).length) + Math.min(6, running(s).length) + s.machines.length : 3;
    openOverlay({ mod: "runners", kind: "popup", width: 420, height: Math.min(640, 150 + rows * ROW), props: { view: "popup" } });
  }

  toggle() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !find(body, "runners")) return this.open();
    if (!panel.hidden && body.active === "runners") run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: "runners" }); run("layout.show", { id: "panel" }); }
  }

  render() {
    const t = theme(), s = snapshot(), c = colors(t);
    const bar = h_flex().id("runners-chip").size_full().px(10).gap(8).overflow_hidden().items_center().cursor_pointer()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .hover((e) => e.bg(t.hover)).on_click(() => this.toggle()).on_mouse_down("right", () => this.open())
      .tooltip("Runners · click: panel · right-click: quick look");
    if (!s) return bar.child("Runners").child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900));
    const sum = summary(s), offline = slots(s).some((r) => r.status === "offline");
    // Narrow status bar: drop the title, then the squares, so the counts always show.
    const groups = s.machines.filter((m) => m.runners.length).map((m) => squares(m.runners, t));
    const full = (this.width ?? Infinity) >= 170 + sum.total * 8 + groups.length * 5, squaresFit = (this.width ?? Infinity) >= 110 + sum.total * 8 + groups.length * 5;
    const state = sum.waiting
      ? div().text_color(c.wait).child(squaresFit ? `${sum.waiting} waiting` : `${sum.busy}/${sum.total} · ${sum.waiting} waiting`)
      : sum.busy ? div().child(squaresFit ? `${sum.busy} running` : `${sum.busy}/${sum.total} running`) : div().text_color(t.dim).child("idle");
    return bar.on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (w !== this.width) { this.width = w; cx.notify(); } })
      .when(full || !squaresFit, (e) => e.child("Runners"))
      .when(squaresFit, (e) => e.child(h_flex().gap(5).items_center().children(groups))).child(state)
      .when(offline, (e) => e.child(div().text_color(c.off).child("offline")))
      .when(Boolean(s.error), (e) => e.child(div().text_color(c.off).child("!")));
  }
}
