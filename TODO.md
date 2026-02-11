
Investigate - tool result => storage & display test

Investigate - decoupled sendToChannel() and saveAssistantMessage()

            await this.sendToChannel(channel, response, { markdown: true });
            this.saveAssistantMessage(message.channel, response, message.metadata?.reasoningMode as string | undefined);

Investigate - removing currentConversationId from supervisor agent, bad design

Investigate - 
    isForCurrentConversation now hides any WebSocket messages that don't include conversationId unless the current conversation is 'feed'. However WebChannel.sendAsAgent() broadcasts 'message' payloads without conversationId (src/channels/web.ts), which will cause non-streaming assistant messages to disappear from normal conversations. Either include conversationId in those payloads server-side or keep the previous behavior for 'message' events when conversationId is missing.

 Or even simpler - since the only broken thing is conversationId not being passed to sendAsAgent(), maybe the minimal
  fix is:

  1. Remove currentConversationId from supervisor instance state
  2. Pass conversationId as a parameter through the call chain where needed
  3. Each handleMessage() call gets conversationId from message.metadata.conversationId

- add ability to investigate Jarvis issue using combination of AI, description, file upload (screenshot) and diagnostic log -> is this a skill? Maybe prototype the Skill to run well in Claude Code, then have it run here?


Won't do:
- A2A - too early, nothing useful to connect to