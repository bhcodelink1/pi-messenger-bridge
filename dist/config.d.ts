import type { MsgBridgeConfig } from "./types.js";
/**
 * Load config from file and env vars (env vars override file).
 */
export declare function loadConfig(): MsgBridgeConfig;
/**
 * Save config to file with secure permissions.
 */
export declare function saveConfig(config: MsgBridgeConfig): void;
//# sourceMappingURL=config.d.ts.map