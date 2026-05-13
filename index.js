#!/usr/bin/env node
/**
 * Self-Healing API Executor MCP Server
 * Provides resilient API execution with retry, circuit breaker, and fallback
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mcp-selfhealing", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Circuit breaker state
const cbState = new Map();

function getCircuitBreaker(key) {
  if (!cbState.has(key)) {
    cbState.set(key, { failures: 0, lastFailure: null, open: false });
  }
  return cbState.get(key);
}

function recordFailure(key) {
  const cb = getCircuitBreaker(key);
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= 3) cb.open = true;
}

function recordSuccess(key) {
  const cb = getCircuitBreaker(key);
  cb.failures = 0;
  cb.open = false;
}

function isCircuitOpen(key) {
  const cb = getCircuitBreaker(key);
  if (!cb.open) return false;
  // Half-open after 60 seconds
  if (Date.now() - cb.lastFailure > 60000) {
    cb.open = false;
    cb.failures = 0;
    return false;
  }
  return true;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_with_retry",
        description: "Execute an API call with automatic retry, exponential backoff, and circuit breaker protection",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "API endpoint URL"
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
              default: "GET"
            },
            headers: {
              type: "object",
              description: "HTTP headers"
            },
            body: {
              type: "string",
              description: "Request body (JSON string)"
            },
            maxRetries: {
              type: "number",
              description: "Maximum retry attempts",
              default: 3
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds",
              default: 30000
            }
          },
          required: ["url"]
        }
      },
      {
        name: "check_health",
        description: "Check the health status of a service with circuit breaker state",
        inputSchema: {
          type: "object",
          properties: {
            serviceKey: {
              type: "string",
              description: "Service identifier (e.g., 'fireworks-api', 'openrouter-api')"
            }
          },
          required: ["serviceKey"]
        }
      },
      {
        name: "reset_circuit_breaker",
        description: "Manually reset a circuit breaker for a service",
        inputSchema: {
          type: "object",
          properties: {
            serviceKey: {
              type: "string",
              description: "Service identifier to reset"
            }
          },
          required: ["serviceKey"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "execute_with_retry") {
    const key = new URL(args.url).hostname;
    
    if (isCircuitOpen(key)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Circuit breaker OPEN for " + key,
            recommendation: "Wait 60s for half-open state or reset manually"
          })
        }]
      };
    }

    const maxRetries = args.maxRetries || 3;
    const timeout = args.timeout || 30000;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(args.url, {
          method: args.method || "GET",
          headers: args.headers || {},
          body: args.body || undefined,
          signal: controller.signal
        });
        
        clearTimeout(timer);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        recordSuccess(key);
        const data = await response.text();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              attempt: attempt + 1,
              status: response.status,
              data: data.substring(0, 5000), // Truncate large responses
              circuitBreaker: getCircuitBreaker(key)
            })
          }]
        };
      } catch (err) {
        lastError = err;
        recordFailure(key);
        
        if (attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          attempts: maxRetries + 1,
          lastError: lastError.message,
          circuitBreaker: getCircuitBreaker(key),
          recommendation: "Service may be down. Check health or switch provider."
        })
      }]
    };
  }

  if (name === "check_health") {
    const cb = getCircuitBreaker(args.serviceKey);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          service: args.serviceKey,
          circuitBreaker: cb,
          status: cb.open ? "OPEN" : (cb.failures > 0 ? "DEGRADED" : "HEALTHY"),
          canExecute: !cb.open
        })
      }]
    };
  }

  if (name === "reset_circuit_breaker") {
    cbState.set(args.serviceKey, { failures: 0, lastFailure: null, open: false });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          service: args.serviceKey,
          message: "Circuit breaker reset"
        })
      }]
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
console.error("Self-Healing API Executor MCP Server running on stdio");
