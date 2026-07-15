import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { DesignThemeProvider } from "./components/design/DesignThemeContext";
import { VersionBadge } from "./components/VersionBadge";
import { PwaPrompt } from "./components/PwaPrompt";
import "./styles.css";
import "./styles/chrome-storybook.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesignThemeProvider>
      <App />
      <PwaPrompt />
      <VersionBadge />
    </DesignThemeProvider>
  </React.StrictMode>
);
