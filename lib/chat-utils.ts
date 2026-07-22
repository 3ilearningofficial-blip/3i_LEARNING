import type { ChatMode } from "@/lib/live-stream/types";

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
 * - disabled: same visibility rules as public for history restore; UI hides the
 *   list behind a locked banner for students (admin still sees messages)
 */
export function filterChatMessages(
  messages: ChatMessage[],
  viewerUserId: number,
  isAdmin: boolean,
  chatMode: ChatMode
): ChatMessage[] {
  if (chatMode === "public" || chatMode === "disabled") {
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
