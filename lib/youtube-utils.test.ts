import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getYouTubeVideoId } from './youtube-utils';

/**
 * Feature: professional-live-class-studio
 * Property 1: YouTube URL format acceptance
 * 
 * **Validates: Requirements 5.4**
 */
describe('getYouTubeVideoId - Property-Based Tests', () => {
  it('Property 1: YouTube URL format acceptance - extracts valid video IDs from all supported formats', () => {
    // Generator for valid YouTube video IDs (11 characters: alphanumeric, underscore, hyphen)
    const videoIdArbitrary = fc.array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 11, maxLength: 11 }
    ).map(chars => chars.join(''));

    // Generator for URL format variants
    const urlFormatArbitrary = fc.constantFrom(
      'https://youtube.com/live/',
      'https://www.youtube.com/live/',
      'https://youtu.be/',
      'https://www.youtu.be/',
      'https://youtube.com/watch?v=',
      'https://www.youtube.com/watch?v=',
      'https://youtube.com/embed/',
      'https://www.youtube.com/embed/',
      'https://youtube-nocookie.com/embed/',
      'https://www.youtube-nocookie.com/embed/',
      'http://youtube.com/live/',
      'http://www.youtube.com/live/',
      'http://youtu.be/',
      'http://www.youtu.be/',
      'http://youtube.com/watch?v=',
      'http://www.youtube.com/watch?v=',
      'http://youtube.com/embed/',
      'http://www.youtube.com/embed/',
      'http://youtube-nocookie.com/embed/',
      'http://www.youtube-nocookie.com/embed/'
    );

    // Combine format and video ID to create full URLs
    const youtubeUrlArbitrary = fc.tuple(urlFormatArbitrary, videoIdArbitrary).map(
      ([format, videoId]) => ({
        url: format + videoId,
        expectedId: videoId,
      })
    );

    // Property: For any valid YouTube URL format with a valid video ID,
    // getYouTubeVideoId should extract a non-empty video ID
    fc.assert(
      fc.property(youtubeUrlArbitrary, ({ url, expectedId }) => {
        const extractedId = getYouTubeVideoId(url);
        
        // The function should extract a valid non-empty video ID
        expect(extractedId).not.toBeNull();
        expect(extractedId).toBe(expectedId);
        expect(extractedId!.length).toBeGreaterThan(0);
        
        // Verify the extracted ID matches the expected format (alphanumeric, underscore, hyphen)
        expect(extractedId).toMatch(/^[a-zA-Z0-9_-]+$/);
      }),
      { numRuns: 20 } // Reduced for faster test execution
    );
  });
});
