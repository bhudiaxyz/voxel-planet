import "./styles.css";
import { Game } from "./core/Game";
import { getSeedFromUrl, generateRandomSeed } from "./utils/Random";

const seed = getSeedFromUrl() ?? generateRandomSeed();

// Show seed in URL without reload
const url = new URL(window.location.href);
url.searchParams.set("seed", String(seed));
window.history.replaceState(null, "", url.toString());

const game = new Game(seed);

// Cleanup on HMR
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
