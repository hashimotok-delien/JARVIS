import AppShell from "./app/AppShell";
import HudOverlay from "./features/hud/HudOverlay";
import QuickPalette from "./features/quick/QuickPalette";

const params = new URLSearchParams(window.location.search);
const kind = params.get("window");
const windowKind = kind === "hud" ? "hud" : kind === "quick" ? "quick" : "main";
document.body.dataset.window = windowKind;

export default function App() {
  if (windowKind === "hud") return <HudOverlay />;
  if (windowKind === "quick") return <QuickPalette />;
  return <AppShell />;
}
