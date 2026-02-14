/**
 * Shared validation utilities for mission tools.
 * Consolidates common validation patterns to reduce duplication.
 */

import type { NativeToolResult } from './types.js';

/**
 * Validates that a required string parameter is present and non-empty.
 * @param value - Value to validate
 * @param fieldName - Field name for error message
 * @param customMessage - Optional custom error message (default: "{fieldName} is required")
 */
export function validateRequired(value: unknown, fieldName: string, customMessage?: string): NativeToolResult | null {
  if (typeof value !== 'string' || !value.trim()) {
    return { success: false, error: customMessage || `${fieldName} is required` };
  }
  return null;
}

/**
 * Validates that a value is one of the allowed enum values.
 */
export function validateEnum(value: string, fieldName: string, allowedValues: readonly string[]): NativeToolResult | null {
  if (!allowedValues.includes(value)) {
    return { 
      success: false, 
      error: `Invalid ${fieldName} "${value}". Must be one of: ${allowedValues.join(', ')}` 
    };
  }
  return null;
}

/**
 * Validates that a number parameter is a valid number.
 */
export function validateNumber(value: unknown, fieldName: string): NativeToolResult | null {
  if (typeof value !== 'number' || isNaN(value)) {
    return { success: false, error: `${fieldName} must be a valid number` };
  }
  return null;
}

/**
 * Validates multiple required fields at once.
 * Returns the first validation error encountered, or null if all valid.
 */
export function validateRequiredFields(params: Record<string, unknown>, fieldNames: string[]): NativeToolResult | null {
  for (const fieldName of fieldNames) {
    const error = validateRequired(params[fieldName], fieldName);
    if (error) return error;
  }
  return null;
}
