// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css"; // or index.css, whatever template uses
import { AppRouter } from "./router";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
);
