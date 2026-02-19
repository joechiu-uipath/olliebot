/**
 * Message Embedding Utilities
 *
 * Shared helper functions for message embedding and search.
 */

/**
 * Create a display snippet from text, truncating at word boundaries.
 * 
 * @param text - The text to create a snippet from
 * @param maxLength - Maximum length of the snippet
 * @returns A truncated snippet with "..." if shortened
 */
export function createSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength / 2 ? truncated.slice(0, lastSpace) : truncated) + '...';
}
