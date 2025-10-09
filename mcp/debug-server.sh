#!/bin/bash

# Wrapper script to capture MCP server logs for debugging
LOG_FILE="/tmp/mcp-server.log"

echo "=== MCP Server Debug Wrapper Starting ===" >> "$LOG_FILE"
echo "Timestamp: $(date)" >> "$LOG_FILE"
echo "Working directory: $(pwd)" >> "$LOG_FILE"
echo "Environment variables:" >> "$LOG_FILE"
env | grep -E "(GITHUB_|MCP_|NODE_)" >> "$LOG_FILE"
echo "Node.js version: $(node --version)" >> "$LOG_FILE"
echo "Arguments: $@" >> "$LOG_FILE"
echo "=== Starting MCP Server ===" >> "$LOG_FILE"

# Execute the actual MCP server, capturing both stdout and stderr
exec node "$@" 2>&1 | tee -a "$LOG_FILE"