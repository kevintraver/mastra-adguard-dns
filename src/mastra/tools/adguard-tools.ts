import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const ADGUARD_API_BASE = 'https://api.adguard-dns.io';
const ADGUARD_DNS_SERVER_ID = process.env.ADGUARD_DNS_SERVER_ID;
const ADGUARD_REFRESH_TOKEN = process.env.ADGUARD_REFRESH_TOKEN;

// In-memory token storage (persists for server lifetime)
let currentAccessToken = process.env.ADGUARD_API_TOKEN || '';

interface QueryLogItem {
  domain: string;
  time_iso: string;
  time_millis: number;
  filtering_info?: {
    filtering_status?: string;
    filter_rule?: string;
    filter_id?: string;
  };
  device_id?: string;
  dns_request_type?: string;
}

interface QueryLogResponse {
  items: QueryLogItem[];
  pages: {
    current: number;
    total: number;
  };
}

interface DNSServerSettings {
  user_rules_settings: {
    enabled: boolean;
    rules: string[];
    rules_count: number;
  };
  // ... other settings fields exist but we only need user_rules_settings
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

/**
 * Refreshes the access token using the refresh token
 */
async function refreshAccessToken(): Promise<string> {
  if (!ADGUARD_REFRESH_TOKEN) {
    throw new Error('ADGUARD_REFRESH_TOKEN environment variable is not set. Cannot refresh token.');
  }

  const response = await fetch(`${ADGUARD_API_BASE}/oapi/v1/oauth_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: ADGUARD_REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as TokenResponse;

  // Update in-memory token
  currentAccessToken = data.access_token;

  console.log('AdGuard API token refreshed successfully');

  return data.access_token;
}

/**
 * Makes an API call with automatic token refresh on 401
 */
async function callAdGuardAPI(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!currentAccessToken) {
    throw new Error('ADGUARD_API_TOKEN environment variable is not set');
  }

  // Add authorization header
  const requestOptions: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      'Authorization': `Bearer ${currentAccessToken}`,
    },
  };

  // Try the request
  let response = await fetch(url, requestOptions);

  // If unauthorized, refresh token and retry once
  if (response.status === 401) {
    console.log('Token expired, refreshing...');

    const newToken = await refreshAccessToken();

    // Retry with new token
    requestOptions.headers = {
      ...requestOptions.headers,
      'Authorization': `Bearer ${newToken}`,
    };

    response = await fetch(url, requestOptions);
  }

  return response;
}

export const getQueryLogTool = createTool({
  id: 'get-adguard-query-log',
  description: 'Fetches recent DNS query logs from AdGuard DNS to identify blocked domains',
  inputSchema: z.object({
    minutes: z.number().default(10).describe('Number of minutes of history to fetch (default: 10)'),
  }),
  outputSchema: z.object({
    blocked_domains: z.array(z.object({
      domain: z.string(),
      blocked_at: z.string(),
      filter_rule: z.string().optional(),
      filter_id: z.string().optional(),
    })),
    total_queries: z.number(),
  }),
  execute: async ({ context }) => {
    const now = Date.now();
    const timeFromMillis = now - (context.minutes * 60 * 1000);
    const timeToMillis = now;

    const url = `${ADGUARD_API_BASE}/oapi/v1/query_log?time_from_millis=${timeFromMillis}&time_to_millis=${timeToMillis}&limit=200`;

    const response = await callAdGuardAPI(url);

    if (!response.ok) {
      throw new Error(`AdGuard API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as QueryLogResponse;

    // Filter for blocked domains
    const blockedDomains = data.items
      .filter(item =>
        item.filtering_info?.filtering_status === 'REQUEST_BLOCKED' ||
        item.filtering_info?.filtering_status === 'RESPONSE_BLOCKED'
      )
      .map(item => ({
        domain: item.domain,
        blocked_at: item.time_iso,
        filter_rule: item.filtering_info?.filter_rule,
        filter_id: item.filtering_info?.filter_id,
      }));

    return {
      blocked_domains: blockedDomains,
      total_queries: data.items.length,
    };
  },
});

export const unblockDomainTool = createTool({
  id: 'unblock-adguard-domain',
  description: 'Adds whitelist rules to unblock one or more domains in AdGuard DNS',
  inputSchema: z.object({
    domains: z.array(z.string()).describe('Array of domains to unblock (e.g., ["example.com", "cdn.example.com"])'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    rules_added: z.array(z.string()),
    already_whitelisted: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    if (!ADGUARD_DNS_SERVER_ID) {
      throw new Error('ADGUARD_DNS_SERVER_ID environment variable is not set');
    }

    // First, get current DNS server (which includes settings)
    const getUrl = `${ADGUARD_API_BASE}/oapi/v1/dns_servers/${ADGUARD_DNS_SERVER_ID}`;
    const getResponse = await callAdGuardAPI(getUrl);

    if (!getResponse.ok) {
      throw new Error(`Failed to get DNS server: ${getResponse.status} ${getResponse.statusText}`);
    }

    const dnsServer = await getResponse.json() as { settings: DNSServerSettings };
    const currentSettings = dnsServer.settings;

    // Create whitelist rules using AdGuard DNS syntax
    const newRules: string[] = [];
    const alreadyWhitelisted: string[] = [];

    for (const domain of context.domains) {
      const whitelistRule = `@@||${domain}^`;

      if (currentSettings.user_rules_settings.rules.includes(whitelistRule)) {
        alreadyWhitelisted.push(domain);
      } else {
        newRules.push(whitelistRule);
      }
    }

    // If all domains are already whitelisted, return early
    if (newRules.length === 0) {
      return {
        success: true,
        message: `All ${context.domains.length} domain(s) are already whitelisted`,
        rules_added: [],
        already_whitelisted: alreadyWhitelisted,
      };
    }

    // Add new rules to existing rules
    const updatedRules = [...currentSettings.user_rules_settings.rules, ...newRules];

    // Update settings with new rules
    const putUrl = `${ADGUARD_API_BASE}/oapi/v1/dns_servers/${ADGUARD_DNS_SERVER_ID}/settings`;
    const putResponse = await callAdGuardAPI(putUrl, {
      method: 'PUT',
      body: JSON.stringify({
        user_rules_settings: {
          enabled: currentSettings.user_rules_settings.enabled,
          rules: updatedRules,
        },
      }),
    });

    if (!putResponse.ok) {
      throw new Error(`Failed to update settings: ${putResponse.status} ${putResponse.statusText}`);
    }

    const newDomains = context.domains.filter(d => !alreadyWhitelisted.includes(d));

    return {
      success: true,
      message: `Successfully added ${newRules.length} whitelist rule(s) for: ${newDomains.join(', ')}`,
      rules_added: newRules,
      already_whitelisted: alreadyWhitelisted,
    };
  },
});
