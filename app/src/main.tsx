import React from "react";
import ReactDOM from "react-dom/client";
// Base styles first: each view's own CSS, imported by the view, comes after.
import "./fonts";
import "./App.css";
import "./companion.css";
import App from "./App";
import PillApp from "./views/PillApp";
import { applyTheme } from "./theme";

// Stesso bundle, due finestre: `#pill` è la finestrella sempre in primo piano
// che il backend apre per confermare avvio/stop e per il conto alla rovescia
// del silenzio (vedi src-tauri/src/companion.rs).
const isPill = window.location.hash === "#pill";
applyTheme();
// App.css dà a html/body il fondo bianco dell'app: nella finestrella serve
// trasparente, altrimenti attorno alla pillola resta un rettangolo bianco.
if (isPill) document.documentElement.classList.add("pill-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isPill ? <PillApp /> : <App />}</React.StrictMode>,
);
