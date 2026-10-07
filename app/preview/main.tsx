// Preview bench: mounts the REAL app (or one of its views) with the real CSS,
// on a real in-browser SQLite with invented data — no Tauri, no ~/.mori.
//
//   ?v=app (default) the whole app        ?v=todos  "To do" alone
//   ?v=people        people & projects    ?v=pill&pill=started|stopped|silence
//   &fresh=1         a brand-new install (migrations only)
import React from "react";
import ReactDOM from "react-dom/client";
import "../src/fonts";
import "../src/App.css";
import "../src/companion.css";
import App from "../src/App";
import TodosView from "../src/views/TodosView";
import PersonView from "../src/views/PersonView";
import PillApp from "../src/views/PillApp";
import { applyTheme, setTheme } from "../src/theme";

const which = new URLSearchParams(location.search).get("v") ?? "app";
// ?theme=dark|light forces a theme for screenshots.
const forced = new URLSearchParams(location.search).get("theme");
if (forced === "dark" || forced === "light") setTheme(forced);
else applyTheme();
const noop = () => {};
const MY = ["Tu", "te", "io", "me", "Alex"];

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
if (which === "pill") {
  document.documentElement.classList.add("pill-window");
  document.body.style.background = "#dfe3ea";
  root.render(<PillApp />);
} else if (which === "todos") {
  root.render(
    <div className="app">
      <main className="detail">
        <TodosView myNames={MY} onOpenCall={noop} onChanged={noop} onError={noop} />
      </main>
    </div>,
  );
} else if (which === "people") {
  root.render(
    <div className="app">
      <main className="detail">
        <PersonView entityId={null} myNames={MY} onOpenEntity={noop} onOpenCall={noop} onAsk={noop} onError={noop} />
      </main>
    </div>,
  );
} else {
  root.render(<App />);
}
