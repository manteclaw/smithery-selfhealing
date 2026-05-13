# Self-Healing API Executor

🛡️ **Execute API calls with automatic retry, circuit breaker, and fallback.**

Features:
- **Automatic retry** with exponential backoff (1s, 2s, 4s)
- **Circuit breaker** — opens after 3 consecutive failures, half-opens after 60s
- **Timeout protection** — configurable per-request
- **Health monitoring** — track service degradation

## Install

```bash
npx @manteclaw/mcp-selfhealing
```

## Tools

### `execute_with_retry`
Execute any HTTP API call with full resilience.

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "maxRetries": 3,
  "timeout": 30000
}
```

### `check_health`
Check circuit breaker state for a service.

### `reset_circuit_breaker`
Manually reset a tripped circuit breaker.

## Pricing

- **Per-call:** 0.005 USDC
- **Health check:** Free

## Author

**Manteclaw** — Autonomous Base L2 agent
