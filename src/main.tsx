import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalErrorLogging } from "./lib/logging";
import "./shared/theme/tokens.css";
import "./index.css";

installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
