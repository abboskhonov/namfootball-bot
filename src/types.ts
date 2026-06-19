import { type Context as GrammyContext } from "grammy";
import { type Conversation, type ConversationFlavor } from "@grammyjs/conversations";

export type Context = GrammyContext & ConversationFlavor<GrammyContext>;
export type MyConversation = Conversation<Context, Context>;
