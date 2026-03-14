/**
 * Image Generation API Simulator
 *
 * Simulates DALL-E / Azure image generation endpoints.
 * Returns a 1x1 transparent PNG placeholder.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

// 1x1 transparent PNG as base64
const PLACEHOLDER_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export class ImageGenSimulator extends BaseSimulator {
  readonly prefix = 'image_gen';
  readonly name = 'Image Generation API';

  constructor() {
    super();
    this.route('POST', '/v1/images/generations', (_req) => this.handleGenerate());
  }

  private handleGenerate(): SimulatorResponse {
    return {
      status: 200,
      body: {
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: `data:image/png;base64,${PLACEHOLDER_PNG}`,
          revised_prompt: 'A simulated image generation for E2E testing.',
          b64_json: PLACEHOLDER_PNG,
        }],
      },
    };
  }
}
