import { inject } from "@vercel/analytics";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./app";
import "./styles.css";

const isVercelDeployment =
  Boolean(import.meta.env.VITE_VERCEL_ENV) ||
  window.location.hostname.endsWith(".vercel.app") ||
  import.meta.env.VITE_VERCEL_ANALYTICS === "true";

if (isVercelDeployment) inject();

const rootElement = document.querySelector<HTMLDivElement>("#root");
if (!rootElement) throw new Error("Missing required element: #root");

document.documentElement.classList.add("dark");
createRoot(rootElement).render(
  <TooltipProvider>
    <App />
  </TooltipProvider>,
);
