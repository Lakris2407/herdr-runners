# Tab-bar menu: choose which panel buttons show

Right-click any panel button in the tab bar (Files, Changes, Runners, ...) for a small menu with a
tick per button. Click a name to show or hide its button at once; the choice is saved in Herdr's
shared state (`tabs-plus.hidden`). Hiding the button of the open panel closes that panel. With every
button hidden, a small `⋯` button stays so the menu is always reachable.

This changes your own clone of Herdr's tab bar (`tabs-plus`, see the README's install steps), so it
ships as a patch, not as a mod. All edits are in `~/.config/herdr-app/mods/tabs-plus/main.js`.

## 1. Imports

Add `v_flex` and `setShared`, `props` if they are missing:

```js
import { h_flex, v_flex } from "gpui-base";
import { /* ...what is there... */ shared, setShared, props } from "herdr";
```

## 2. Above the class

List your panel buttons once, in tab-bar order. Use the ids of your `panel-body` children:

```js
// The side-panel buttons, in tab-bar order. Right-click any of them to choose which show.
const PANELS = [
  ["files", "Files", "mods/files/file.svg"],
  ["changes", "Changes", "mods/changes/changes.svg"],
  ["runners", "Runners", "mods/runners/runners.svg"],
];
const HIDDEN = "tabs-plus.hidden";

function openPanelMenu() {
  openOverlay({ mod: "tabs-plus", kind: "popup", width: 210, height: 48 + PANELS.length * 30, props: { menu: "panels" } });
}

// The popup: a check per button; a click shows or hides it at once.
function panelMenu(t) {
  const hidden = shared(HIDDEN) ?? [];
  return v_flex().size_full().p(6).gap(1).bg(t.popover).text_size(12).text_color(t.foreground)
    .child(div().px(8).py(4).text_size(11).text_color(t.dim).child("Buttons in the tab bar"))
    .children(PANELS.map(([id, label, icon]) => {
      const on = !hidden.includes(id);
      return h_flex().id(`menu-${id}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.hover))
        .on_click(() => setShared(HIDDEN, on ? [...hidden, id] : hidden.filter(h => h !== id)))
        .child(div().w(14).text_color(t.accent).child(on ? "✓" : ""))
        .child(svg(icon).size(14).text_color(on ? t.foreground : t.dim))
        .child(div().text_color(on ? t.foreground : t.dim).child(label));
    }));
}
```

## 3. In `render()`

First line after `const t = theme();`: the same mod draws the popup.

```js
if (props()?.menu === "panels") return panelMenu(t);
```

Where `enabled` is built, leave out hidden buttons and close a panel whose button was hidden:

```js
const hidden = shared(HIDDEN) ?? [];
const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "runners"].filter(id => !hidden.includes(id));
if (panel && !panel.hidden && body?.active && PANELS.some(([id]) => id === body.active) && !enabled.includes(body.active)) run("layout.hide", { id: "panel" });
```

In `panelButton`, open the menu on a right-click:

```js
.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openPanelMenu(); })
```

Replace the separate `panelButton(...)` children with one list, plus the `⋯` fallback:

```js
.children(PANELS.filter(([id]) => enabled.includes(id)).map(([id, label, icon]) => panelButton(id, label, icon)))
.when(!PANELS.some(([id]) => enabled.includes(id)), el => el.child(button("panels-menu", "⋯", () => openPanelMenu())))
```

Then run `herdr-app check ~/.config/herdr-app/mods/tabs-plus`.
