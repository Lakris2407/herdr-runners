// What waits for your self-hosted runners and build machines, what runs on them, and how hard each one works.
// One mod, four views sharing one snapshot (poll.js): the panel, or props.view "chip" (status bar),
// "popup" (the chip's click) and "lanes" (the timeline window, opened on demand).
import { View } from "gpui-kit";
import { props, nextCommand } from "herdr";
import { tick, refresh, snapshot } from "./poll.js";
import { openLanes } from "./ui.js";
import { Chip } from "./chip.js";
import { Popup } from "./popup.js";
import { Panel } from "./panel.js";
import { Lanes } from "./lanes.js";

const VIEWS = { chip: Chip, popup: Popup, lanes: Lanes };
const CHECK_MS = 5000;

export default class Runners extends View {
  init(_props, cx) {
    this.view = new (VIEWS[props()?.view] ?? Panel)();
    this.view.init(props(), cx);
    // Only a due snapshot starts a read, so this is cheap in every copy.
    tick(cx);
    // Redraw only while something waits or runs: its clock moves.
    cx.timer.every(CHECK_MS, (cx) => {
      tick(cx);
      if (snapshot()?.jobs.some((j) => j.status !== "completed")) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") refresh();
        if (c === "timeline") openLanes();
        tick(cx);
        cx.notify();
      }
    });
  }

  render(cx) {
    return this.view.render(cx);
  }
}
