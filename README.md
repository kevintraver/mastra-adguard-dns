# AdGuard DNS Troubleshooting Agent

A Mastra AI agent that helps identify and unblock domains causing service issues by analyzing AdGuard DNS query logs.

## Features

- 🔍 **Intelligent Query Log Analysis** - Analyzes recent DNS queries to identify blocked domains
- 🤖 **AI-Powered Correlation** - Uses Claude Sonnet 4.5 to match blocked domains with service issues
- ⚡ **Multi-Domain Unblocking** - Unblock multiple domains in a single API call
- 🔄 **Automatic Token Refresh** - Handles AdGuard DNS API authentication automatically
- 📊 **Configurable Time Windows** - Search query logs from the last 10 minutes to hours back

## How It Works

1. **User reports an issue**: "Netflix isn't loading"
2. **Agent fetches query logs**: Retrieves up to 200 recent DNS queries
3. **AI analyzes blocked domains**: Identifies likely culprits (CDNs, APIs, auth providers)
4. **Presents findings**: Ranked list with reasoning for each suggestion
5. **Unblocks on confirmation**: Adds whitelist rules after user approval

## Prerequisites

- Node.js >= 20.9.0
- AdGuard DNS account with API access
- Anthropic API key (for Claude)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/kevintraver/mastra-adguard-dns.git
cd mastra-adguard-dns
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:

Create a `.env` file:
```bash
cp .env.example .env
```

Add your API credentials:
```env
# OpenAI API Key (optional, for other models)
OPENAI_API_KEY=your_openai_key_here

# Anthropic API Key (required for Claude)
ANTHROPIC_API_KEY=your_anthropic_key_here

# AdGuard DNS API Configuration
ADGUARD_API_TOKEN=your_access_token_here
ADGUARD_REFRESH_TOKEN=your_refresh_token_here
ADGUARD_DNS_SERVER_ID=your_dns_server_id_here
```

### Getting AdGuard DNS Credentials

1. **Get initial tokens**:
```bash
curl -X POST https://api.adguard-dns.io/oapi/v1/oauth_token \
  -H "Content-Type: application/json" \
  -d '{"username": "your_email", "password": "your_password"}'
```

This returns both `access_token` and `refresh_token`. Add both to `.env`.

2. **Get your DNS server ID**:
```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://api.adguard-dns.io/oapi/v1/dns_servers
```

Copy the `id` field from the response to `.env` as `ADGUARD_DNS_SERVER_ID`.

## Usage

### Development Mode

Start the Mastra development server:
```bash
npm run dev
```

Access the UI at `http://localhost:4111` and select the "AdGuard DNS Helper" agent.

### Example Conversations

**Troubleshooting Netflix:**
```
User: Netflix isn't working
Agent: [Fetches logs, analyzes blocked domains]
Agent: I found 3 blocked domains that could be causing this:
1. nflxvideo.net - Netflix's CDN (HIGH confidence)
2. netflix.com - Direct Netflix domain (HIGH confidence)
3. api-global.netflix.com - Netflix API (MEDIUM confidence)

Would you like me to unblock these domains?
User: Yes, unblock them
Agent: ✅ Successfully unblocked 3 domains
```

**Expanding Search Window:**
```
User: My banking app won't load
Agent: [Searches last 10 minutes, finds nothing]
Agent: Let me check a longer time window...
Agent: [Searches last 30 minutes]
Agent: Found these blocked domains from 15 minutes ago...
```

## Tools

### getQueryLogTool
Fetches DNS query logs from AdGuard DNS.

**Parameters:**
- `minutes` (optional): Number of minutes to look back (default: 10)

**Returns:**
- `blocked_domains`: Array of blocked domains with timestamps and filter info
- `total_queries`: Total number of queries in the time window

### unblockDomainTool
Adds whitelist rules to unblock domains.

**Parameters:**
- `domains`: Array of domains to unblock (e.g., `["example.com", "cdn.example.com"]`)

**Returns:**
- `success`: Whether the operation succeeded
- `rules_added`: Array of rules that were added
- `already_whitelisted`: Domains that were already whitelisted

## Configuration

### Agent Settings

The agent is configured in `src/mastra/agents/adguard-agent.ts`:

```typescript
export const adguardAgent = new Agent({
  name: 'AdGuard DNS Helper',
  model: 'anthropic/claude-sonnet-4-5',
  tools: {
    getQueryLogTool,
    unblockDomainTool,
  },
  // ... additional configuration
});
```

### Query Log Limits

The tool fetches up to **200 query log entries** per request. You can modify this in `src/mastra/tools/adguard-tools.ts`:

```typescript
const url = `${ADGUARD_API_BASE}/oapi/v1/query_log?...&limit=200`;
```

Maximum supported by AdGuard API: **1000**

## Project Structure

```
adguard-mastra/
├── src/
│   └── mastra/
│       ├── agents/
│       │   └── adguard-agent.ts      # Main agent configuration
│       ├── tools/
│       │   └── adguard-tools.ts      # Query log & unblock tools
│       └── index.ts                  # Mastra instance setup
├── .env                              # Environment configuration
├── package.json
└── tsconfig.json
```

## Building for Production

Build the application:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

The built application will be in `.mastra/output/`.

## Troubleshooting

### "Token expired" errors
The tool automatically refreshes tokens. Ensure `ADGUARD_REFRESH_TOKEN` is set in `.env`.

### "DNS server not found" (404)
Verify your `ADGUARD_DNS_SERVER_ID` is correct by listing your DNS servers:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.adguard-dns.io/oapi/v1/dns_servers
```

### Agent not finding blocked domains
- Try expanding the time window (agent should do this automatically)
- Check that domains were actually blocked in the AdGuard DNS dashboard
- Verify the query log limit is high enough (currently 200)

## API Rate Limits

AdGuard DNS API has rate limits. The tool minimizes API calls by:
- Fetching up to 200 entries per query
- Unblocking multiple domains in a single API call
- Only refreshing tokens when they expire (401 response)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Credits

Built with [Mastra](https://mastra.ai/) - The TypeScript AI framework

🤖 Generated with [Claude Code](https://claude.com/claude-code)
