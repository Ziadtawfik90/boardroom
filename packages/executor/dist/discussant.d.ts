import type { Connection } from './connection.js';
export declare class Discussant {
    private connection;
    private responding;
    private recentMessages;
    constructor(connection: Connection);
    addMessage(sender: string, content: string): void;
    respondToUser(discussionId: string, turnPrompt: string): Promise<void>;
    private buildContext;
    private callClaudeCli;
}
//# sourceMappingURL=discussant.d.ts.map