/**
 * main-menu.ts — Interactive main menu for /msg-bridge.
 *
 * Shows transport status in the title, with Connect, Configure, Widget, and Help.
 */
import type { ChallengeAuth } from "../auth/challenge-auth.js";
import type { TransportManager } from "../transports/manager.js";
export type MenuUI = {
    select(title: string, options: string[]): Promise<string | undefined>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
    notify(message: string, type: "info" | "warning" | "error"): void;
};
export interface MenuContext {
    ui: MenuUI;
    transportManager: TransportManager;
    auth: ChallengeAuth;
    updateWidget: () => void;
}
export declare function openMainMenu(mctx: MenuContext): Promise<void>;
//# sourceMappingURL=main-menu.d.ts.map