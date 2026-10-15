/**
 * Challenge-based authentication for remote messengers
 * Ported from vscode-chonky-remote-pilot
 */
/**
 * Manages authentication via 6-digit challenge codes and trusted users
 */
export declare class ChallengeAuth {
    private onShowCode;
    private onNotify;
    private onSendMessage?;
    private onSaveAuth?;
    private challenges;
    private trustedUsers;
    private channelAuth;
    private blockedUsers;
    private adminUserId?;
    constructor(onShowCode: (code: string, username: string) => void, onNotify: (message: string, level?: "info" | "warning" | "error") => void, onSendMessage?: ((chatId: string, message: string) => Promise<void>) | undefined, onSaveAuth?: (() => void) | undefined);
    /**
     * Initialize auth state from config
     */
    loadFromConfig(config: {
        trustedUsers?: string[];
        adminUserId?: string;
        channels?: Record<string, {
            enabled: boolean;
            mode: "all" | "mentions" | "trusted-only";
        }>;
    }): void;
    /**
     * Export auth state for config persistence
     */
    exportConfig(): {
        trustedUsers: string[];
        adminUserId?: string;
        channels: Record<string, {
            enabled: boolean;
            mode: "all" | "mentions" | "trusted-only";
        }>;
    };
    /**
     * Check if a user is authorized to send messages
     * Handles challenge creation, validation, and channel authorization
     */
    checkAuthorization(userId: string, chatId: string, username: string, isGroupChat: boolean, wasMentioned: boolean, sendMessage?: (chatId: string, message: string) => Promise<void>, transport?: string): Promise<boolean>;
    /**
     * Initiate or validate a challenge
     */
    private initiateChallenge;
    /**
     * Handle admin commands in DM
     * Returns true if command was handled
     */
    handleAdminCommand(text: string, _chatId: string, userId: string, sendMessage: (text: string) => Promise<void>, transport?: string): Promise<boolean>;
    /**
     * Validate a challenge code entered by the user
     */
    private validateChallenge;
    /**
     * Generate a random 6-digit code
     */
    private generateCode;
    /**
     * Get help text for admin commands
     */
    private getHelpText;
    /**
     * Get current stats with detailed user info
     */
    getStats(): {
        trustedUsers: number;
        channels: number;
        usersByTransport: Record<string, string[]>;
    };
}
//# sourceMappingURL=challenge-auth.d.ts.map