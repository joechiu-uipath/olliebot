/**
 * Type declarations for d3des.js (VNC DES encryption)
 */

/**
 * Generate VNC authentication response from challenge and password.
 * @param challenge - 16-byte challenge from VNC server
 * @param password - VNC password (max 8 characters)
 * @returns 16-byte DES-encrypted response
 */
export function response(challenge: Buffer, password: string): Buffer;
