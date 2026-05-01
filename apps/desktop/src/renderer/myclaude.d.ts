import type { MyClaudeBridge } from "../shared/bridge.js";

declare global {
  interface Window {
    myclaude?: MyClaudeBridge;
  }
}
