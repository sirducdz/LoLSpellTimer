import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress Edge WebView2 default right-click menu, image drag, and browser shortcuts
// Use bubble phase so React's onContextMenu on D/F/R timer buttons runs first.
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

window.addEventListener("dragstart", (e) => {
  e.preventDefault();
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  const isCtrlOrMeta = e.ctrlKey || e.metaKey;
  if (
    e.key === "F5" ||
    e.key === "F12" ||
    (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
    (isCtrlOrMeta && ["r", "p", "s", "u", "f", "g"].includes(key)) ||
    (isCtrlOrMeta && e.shiftKey && ["i", "j", "c"].includes(key))
  ) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
