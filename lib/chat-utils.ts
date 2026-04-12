export interface ChatMessage {
  id: number;
  user_id: number;
  is_admin: boolean;
  message: string;
  user_name: string;
  created_at: number;
}

/**
 * Filters chat messages based on chat mode and viewer identity.
 *
 * - public mode: returns all messages (everyone sees everything)
 * - private mode: returns only admin messages + the viewer's own messages
 */
export function filterChatMessages(
  messages: ChatMessage[],
  viewerUserId: number,
  isAdmin: boolean,
  chatMode: "public" | "private"
): ChatMessage[] {
  if (chatMode === "public") {
    return messages;
  }

  // Private mode: admins see everything, students see only admin msgs + their own
  if (isAdmin) {
    return messages;
  }

  return messages.filter(
    (msg) => msg.is_admin || msg.user_id === viewerUserId
  );
}
