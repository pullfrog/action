## CURRENT

[] gemini installation speed (bundle/esm.sh?) (TODO: SHAWN)
[] handle defaulting agent name value (TODO: SHAWN)
[] test agent/mode combinations
[] test if home directory mcp.json works if mcp.json is specified in repo
[] write Plan to issue/PR body
[] "Implement plan" button 
[] avoid passing all of process.env into agents: minimum # of vars
[] web access settings
[x] add footer to the working comment
[x] toon encode in prompt
[x] branching: use pullfrog/ prefix
[x] test modifications to existing PRs (proper branching)


## MAYBE

[] investigate repo config file
[] try to find heavy claude code user
[] investigate including terminal output from bash commands as collapsed groups from claude
[] test initialization trade offs for pullfrog.yml

## DONE
 
[x] investigate mcp naming convention
[x] input just accepts one key for API key
[x] look into trigger.yml without installation
[x] cancel installation token at the end of github action
[x] avoid exposing env adding ## SECURITY prompt
[x] add modes to prompt 
[x] progressively update comment
[x] don't allow rejecting prs
[x] fix pnpm caching
[x] fix prompt to avoid narration like "I just read all tools from MCP server"
[x] handle progressive comment updating from pullfrog mcp
[x] jules/gemini support
[x] standardize mcp server
[x] entry.js
[x] split up prompts, load dynamically based on mode
[x] log.txt to stdout
[x] rename mcp to use underscore
[x] external.ts align to agents
