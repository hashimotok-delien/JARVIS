import AppShell from "./app/AppShell";
import HudOverlay from "./features/hud/HudOverlay";

const params = new URLSearchParams(window.location.search);
const windowKind = params.get("window") === "hud" ? "hud" : "main";
document.body.dataset.window = windowKind;

export default function App() {
  return windowKind === "hud" ? <HudOverlay /> : <AppShell />;
}
