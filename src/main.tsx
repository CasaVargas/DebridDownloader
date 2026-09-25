import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { applyStoredAppearance } from "./hooks/useAppearance";

// Theme the document before first paint; Layout's useAppearance keeps it live afterwards.
applyStoredAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
