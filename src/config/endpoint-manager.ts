/**
 * EndpointManager - Centralized endpoint configuration for all network dependencies.
 *
 * In production, endpoints resolve to real external services.
 * In E2E test mode, all endpoints are redirected to a local dependency simulator.
 *
 * Usage:
 *   import { endpoints } from './config/endpoint-manager.js';
 *   const url = endpoints.resolve('anthropic', '/v1/messages');
 */

export interface EndpointConfig {
  /** Base URL override (e.g., 'http://localhost:4100') */
  baseUrl: string;
}

export type ServiceName =
  | 'anthropic'
  | 'openai'
  | 'azure_openai'
  | 'google'
  | 'tavily'
  | 'serper'
  | 'google_custom_search'
  | 'embedding'
  | 'image_gen'
  | 'voice'
  | 'web_scrape';

const DEFAULT_ENDPOINTS: Record<ServiceName, EndpointConfig> = {
  anthropic: { baseUrl: 'https://api.anthropic.com' },
  openai: { baseUrl: 'https://api.openai.com' },
  azure_openai: { baseUrl: '' }, // Set from AZURE_OPENAI_ENDPOINT env
  google: { baseUrl: 'https://generativelanguage.googleapis.com' },
  tavily: { baseUrl: 'https://api.tavily.com' },
  serper: { baseUrl: 'https://google.serper.dev' },
  google_custom_search: { baseUrl: 'https://www.googleapis.com' },
  embedding: { baseUrl: '' }, // Follows provider
  image_gen: { baseUrl: '' }, // Follows provider
  voice: { baseUrl: '' }, // Follows provider
  web_scrape: { baseUrl: '' }, // Direct fetch
};

class EndpointManager {
  private overrides: Map<ServiceName, EndpointConfig> = new Map();
  private _isTestMode = false;

  /**
   * Check if running in E2E test mode.
   */
  get isTestMode(): boolean {
    return this._isTestMode;
  }

  /**
   * Enable E2E test mode. Redirects all services to the simulator base URL.
   */
  enableTestMode(simulatorBaseUrl: string): void {
    this._isTestMode = true;
    const services: ServiceName[] = [
      'anthropic', 'openai', 'azure_openai', 'google',
      'tavily', 'serper', 'google_custom_search',
      'embedding', 'image_gen', 'voice', 'web_scrape',
    ];
    for (const service of services) {
      this.overrides.set(service, { baseUrl: `${simulatorBaseUrl}/${service}` });
    }
  }

  /**
   * Override a specific service endpoint.
   */
  setEndpoint(service: ServiceName, config: EndpointConfig): void {
    this.overrides.set(service, config);
  }

  /**
   * Resolve the full URL for a service endpoint.
   */
  resolve(service: ServiceName, path = ''): string {
    const override = this.overrides.get(service);
    if (override) {
      return `${override.baseUrl}${path}`;
    }
    const defaultConfig = DEFAULT_ENDPOINTS[service];
    return `${defaultConfig.baseUrl}${path}`;
  }

  /**
   * Get the base URL for a service.
   */
  getBaseUrl(service: ServiceName): string {
    return this.overrides.get(service)?.baseUrl ?? DEFAULT_ENDPOINTS[service].baseUrl;
  }

  /**
   * Reset all overrides (useful for test cleanup).
   */
  reset(): void {
    this.overrides.clear();
    this._isTestMode = false;
  }
}

/** Singleton instance */
export const endpoints = new EndpointManager();

/**
 * Initialize endpoint manager from environment.
 * Call during app startup after env validation.
 */
export function initEndpoints(config: {
  azureOpenaiEndpoint?: string;
  e2eSimulatorUrl?: string;
}): void {
  if (config.azureOpenaiEndpoint) {
    endpoints.setEndpoint('azure_openai', { baseUrl: config.azureOpenaiEndpoint });
  }

  // E2E_SIMULATOR_URL env var enables test mode
  if (config.e2eSimulatorUrl) {
    endpoints.enableTestMode(config.e2eSimulatorUrl);
  }
}
