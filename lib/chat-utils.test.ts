import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterChatMessages, ChatMessage } from './chat-utils';

/**
 * Feature: professional-live-class-studio
 * Property 2: Chat mode message filtering
 * 
 * **Validates: Requirements 9.3, 9.4**
 */
describe('filterChatMessages - Property-Based Tests', () => {
  it('Property 2: Chat mode message filtering - correctly filters messages for public and private modes', () => {
    // Generator for user IDs (positive integers)
    const userIdArbitrary = fc.integer({ min: 1, max: 10000 });

    // Generator for a single chat message
    const chatMessageArbitrary = fc.record({
      id: fc.integer({ min: 1, max: 100000 }),
      user_id: userIdArbitrary,
      is_admin: fc.boolean(),
      message: fc.string({ minLength: 1, maxLength: 200 }),
      user_name: fc.string({ minLength: 1, maxLength: 50 }),
      created_at: fc.integer({ min: 1000000000000, max: 9999999999999 }),
    }) as fc.Arbitrary<ChatMessage>;

    // Generator for an array of chat messages
    const messagesArbitrary = fc.array(chatMessageArbitrary, { minLength: 0, maxLength: 50 });

    // Generator for chat mode
    const chatModeArbitrary = fc.constantFrom('public' as const, 'private' as const);

    // Generator for viewer identity (userId and isAdmin flag)
    const viewerArbitrary = fc.record({
      userId: userIdArbitrary,
      isAdmin: fc.boolean(),
    });

    // Property: For any set of messages, viewer, and chat mode,
    // the filtering should follow the correct rules
    fc.assert(
      fc.property(
        messagesArbitrary,
        viewerArbitrary,
        chatModeArbitrary,
        (messages, viewer, chatMode) => {
          const filtered = filterChatMessages(
            messages,
            viewer.userId,
            viewer.isAdmin,
            chatMode
          );

          if (chatMode === 'public') {
            // Public mode: all messages should be returned
            expect(filtered).toEqual(messages);
            expect(filtered.length).toBe(messages.length);
          } else {
            // Private mode
            if (viewer.isAdmin) {
              // Admins see everything in private mode
              expect(filtered).toEqual(messages);
              expect(filtered.length).toBe(messages.length);
            } else {
              // Students see only admin messages + their own messages
              const expectedMessages = messages.filter(
                (msg) => msg.is_admin || msg.user_id === viewer.userId
              );
              expect(filtered).toEqual(expectedMessages);
              expect(filtered.length).toBe(expectedMessages.length);

              // Verify each filtered message is either from admin or from the viewer
              filtered.forEach((msg) => {
                expect(msg.is_admin || msg.user_id === viewer.userId).toBe(true);
              });

              // Verify no messages from other students are included
              const otherStudentMessages = filtered.filter(
                (msg) => !msg.is_admin && msg.user_id !== viewer.userId
              );
              expect(otherStudentMessages.length).toBe(0);
            }
          }
        }
      ),
      { numRuns: 20 } // Reduced for faster test execution
    );
  });
});
