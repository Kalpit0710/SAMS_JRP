import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./i18n";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./lib/toast.tsx";

// StrictMode is intentionally omitted: its dev-only double-invoke of effects issues
// duplicate audited GET requests, which pollutes the local audit timeline.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>,
)
