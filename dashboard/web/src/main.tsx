import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./app.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Lets the app be kept on a phone's home screen and open without a connection.
registerServiceWorker();
