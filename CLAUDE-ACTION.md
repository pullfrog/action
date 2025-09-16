# Claude Code Action Architecture & Flow

This document provides a comprehensive overview of how the official (Anthropic) Claude Code Action works, from token exchange through post-run cleanup.

## Overview

The Claude Code Action is a sophisticated GitHub automation platform that enables Claude to interact with GitHub repositories through secure token exchange, intelligent mode detection, and comprehensive GitHub API integration.

## High-Level Architecture

```mermaid
graph TD
    Start([GitHub Action Triggered]) --> Setup[Setup Environment<br/>- Install Bun<br/>- Install Dependencies]
    
    Setup --> ParseContext[Parse GitHub Context<br/>- Extract event data<br/>- Parse inputs]
    
    ParseContext --> ModeDetection{Mode Detection}
    
    ModeDetection -->|Has explicit prompt| AgentMode[AGENT MODE<br/>Direct automation]
    ModeDetection -->|@claude mention/assignment/label| TagMode[TAG MODE<br/>Interactive response]
    ModeDetection -->|No trigger| DefaultAgent[Default to Agent<br/>(won't trigger)]
    
    %% Token Exchange Branch
    AgentMode --> TokenExchange[Token Exchange Process]
    TagMode --> TokenExchange
    TokenExchange --> TokenMethod{Token Method}
    
    TokenMethod -->|Custom token provided| UseCustom[Use Custom GitHub Token]
    TokenMethod -->|No custom token| OIDC[Generate OIDC Token<br/>core.getIDToken()]
    
    OIDC --> Exchange[Exchange OIDC for App Token<br/>api.anthropic.com/api/github/github-app-token-exchange]
    Exchange --> CreateOctokit[Create Authenticated Octokit Client<br/>REST + GraphQL]
    UseCustom --> CreateOctokit
    
    %% Permission Checks
    CreateOctokit --> PermCheck[Check Write Permissions<br/>Only for entity contexts]
    PermCheck -->|No permissions| PermFail[❌ Exit: No write access]
    PermCheck -->|Has permissions| TriggerCheck{Check Trigger Conditions}
    
    %% Trigger Validation
    TriggerCheck -->|Agent Mode| AgentTrigger{Has explicit prompt?}
    TriggerCheck -->|Tag Mode| TagTrigger{Contains @claude mention<br/>or assignment/label?}
    
    AgentTrigger -->|No prompt| NoTrigger[❌ Skip: No trigger found]
    AgentTrigger -->|Has prompt| PrepareAgent[Prepare Agent Mode]
    TagTrigger -->|No mention| NoTrigger
    TagTrigger -->|Has mention| PrepareTag[Prepare Tag Mode]
    
    %% Mode-Specific Preparation
    PrepareAgent --> AgentPrep[Agent Mode Preparation<br/>- Create prompt file<br/>- Setup MCP servers<br/>- No tracking comment]
    PrepareTag --> TagPrep[Tag Mode Preparation<br/>- Create tracking comment<br/>- Setup branches<br/>- Fetch GitHub data<br/>- Setup MCP servers]
    
    %% Data Fetching (Tag Mode)
    TagPrep --> DataFetch[Fetch GitHub Data<br/>GraphQL + REST API]
    DataFetch --> FetchWhat{What to fetch?}
    
    FetchWhat -->|Pull Request| PRData[PR Data:<br/>- Comments & reviews<br/>- Changed files + SHAs<br/>- Commit history<br/>- Author info]
    FetchWhat -->|Issue| IssueData[Issue Data:<br/>- Comments<br/>- Issue details<br/>- Author info]
    
    PRData --> ProcessImages[Process Images<br/>Download & convert to base64]
    IssueData --> ProcessImages
    ProcessImages --> SetupBranch[Setup Branch<br/>- Create Claude branch<br/>- Configure git auth]
    
    %% MCP Server Setup
    AgentPrep --> MCPSetup[Setup MCP Servers]
    SetupBranch --> MCPSetup
    
    MCPSetup --> MCPServers{MCP Servers}
    MCPServers --> GitHubActions[GitHub Actions Server<br/>- Workflow data<br/>- CI results]
    MCPServers --> GitHubComments[GitHub Comment Server<br/>- Comment operations]
    MCPServers --> GitHubFiles[GitHub File Ops Server<br/>- File operations<br/>- Branch management]
    MCPServers --> GitHubInline[GitHub Inline Comment Server<br/>- PR review comments]
    
    GitHubActions --> PromptGen[Generate Prompt]
    GitHubComments --> PromptGen
    GitHubFiles --> PromptGen
    GitHubInline --> PromptGen
    
    %% Prompt Generation
    PromptGen --> PromptType{Prompt Type}
    PromptType -->|Agent Mode| AgentPrompt[Agent Prompt:<br/>- Direct user prompt<br/>- Minimal context]
    PromptType -->|Tag Mode| TagPrompt[Tag Prompt:<br/>- Rich GitHub context<br/>- PR/Issue details<br/>- Changed files<br/>- Comments & reviews<br/>- Commit instructions]
    
    AgentPrompt --> ClaudeRun[Run Claude Code]
    TagPrompt --> ClaudeRun
    
    %% Claude Execution
    ClaudeRun --> ClaudeExec[Claude Code Execution<br/>base-action/src/index.ts]
    ClaudeExec --> ClaudeArgs[Prepare Claude Args<br/>- Prompt file path<br/>- Custom claude_args<br/>- Output format: stream-json]
    
    ClaudeArgs --> ClaudeProvider{Provider}
    ClaudeProvider -->|Default| AnthropicAPI[Anthropic API<br/>ANTHROPIC_API_KEY]
    ClaudeProvider -->|Bedrock| AWSBedrock[AWS Bedrock<br/>OIDC + AWS credentials]
    ClaudeProvider -->|Vertex| GCPVertex[GCP Vertex AI<br/>OIDC + GCP credentials]
    
    AnthropicAPI --> ClaudeProcess[Spawn Claude Process<br/>- Named pipe for input<br/>- Stream JSON output]
    AWSBedrock --> ClaudeProcess
    GCPVertex --> ClaudeProcess
    
    ClaudeProcess --> ClaudeTools[Claude Tool Usage<br/>- MCP tools<br/>- File operations<br/>- GitHub API calls<br/>- Bash commands]
    
    ClaudeTools --> ClaudeOutput[Claude Output Processing<br/>- Capture execution log<br/>- Parse JSON stream<br/>- Extract metrics]
    
    %% Post-Run Actions
    ClaudeOutput --> PostRun{Post-Run Actions}
    
    PostRun -->|Success| Success[✅ Success Path]
    PostRun -->|Failure| Failure[❌ Failure Path]
    
    Success --> UpdateComment[Update Tracking Comment<br/>- Job run link<br/>- Branch link<br/>- PR link (if created)<br/>- Execution metrics]
    Failure --> UpdateComment
    
    UpdateComment --> BranchCleanup[Branch Cleanup<br/>- Check for changes<br/>- Delete empty branches<br/>- Keep branches with commits]
    
    BranchCleanup --> FormatReport[Format Execution Report<br/>- Parse conversation turns<br/>- Format tool usage<br/>- Add to GitHub step summary]
    
    FormatReport --> RevokeToken[Revoke App Token<br/>DELETE /installation/token]
    
    RevokeToken --> End([Action Complete])
```

## Key Components

### 1. Token Exchange Process

The action uses a secure OIDC token exchange system:

1. **OIDC Token Generation**: `core.getIDToken("claude-code-github-action")`
2. **Token Exchange**: POST to `https://api.anthropic.com/api/github/github-app-token-exchange`
3. **Authentication**: Creates authenticated Octokit clients for GitHub API access

**Security Benefits:**
- Repository-scoped access
- Time-limited tokens
- Permission-limited (only configured GitHub App permissions)
- Automatic token masking in logs

### 2. Mode Detection

The action automatically detects the appropriate execution mode:

#### **Agent Mode**
- **Trigger**: Explicit `prompt` input provided
- **Use Case**: Direct automation, custom workflows
- **Behavior**: Minimal context, direct execution
- **Tracking**: No tracking comments

#### **Tag Mode**  
- **Trigger**: @claude mentions, issue assignments, or labels
- **Use Case**: Interactive GitHub responses
- **Behavior**: Rich context, comprehensive GitHub data
- **Tracking**: Creates and updates tracking comments

### 3. Data Fetching (Tag Mode)

When in Tag Mode, the action fetches comprehensive GitHub context:

#### **Pull Request Data:**
- Comments and reviews (including inline comments)
- Changed files with SHAs
- Commit history and metadata
- Author information
- File diff data

#### **Issue Data:**
- Issue details and metadata  
- All comments
- Author information
- Labels and assignments

#### **Image Processing:**
- Downloads images from GitHub
- Converts to base64 for Claude
- Maps original URLs to processed content

### 4. MCP Server Integration

The action sets up multiple MCP (Model Context Protocol) servers to provide Claude with GitHub capabilities:

#### **GitHub Actions Server**
- Access to workflow runs and CI data
- Build status and test results
- Artifact information

#### **GitHub Comment Server**
- Comment creation and updates
- Issue and PR comment management

#### **GitHub File Operations Server**
- File reading and writing
- Branch creation and management
- Commit operations

#### **GitHub Inline Comment Server**
- PR review comment operations
- Line-specific feedback

### 5. Prompt Generation

The action generates context-rich prompts based on the detected mode:

#### **Agent Mode Prompts:**
- Direct user prompt
- Minimal GitHub context
- Focused on specific task

#### **Tag Mode Prompts:**
- Comprehensive GitHub context
- PR/Issue details and history
- Changed files and diffs
- Comment threads and reviews
- Commit instructions and guidelines

### 6. Claude Execution

The action runs Claude Code through multiple provider options:

#### **Provider Support:**
- **Anthropic API** (default): Direct API access with API key
- **AWS Bedrock**: OIDC authentication with AWS credentials
- **GCP Vertex AI**: OIDC authentication with GCP credentials

#### **Execution Process:**
1. **Named Pipe Setup**: Creates pipe for prompt input
2. **Process Spawning**: Spawns Claude Code process
3. **Stream Processing**: Captures JSON stream output
4. **Tool Integration**: Enables MCP tools and GitHub operations

### 7. Post-Run Actions

After Claude execution, the action performs comprehensive cleanup and reporting:

#### **Comment Updates:**
- Updates tracking comments with results
- Adds job run links and execution metrics
- Includes branch and PR links when created

#### **Branch Management:**
- Checks for actual changes in Claude branches
- Deletes empty branches to avoid clutter
- Preserves branches with meaningful commits

#### **Report Generation:**
- Parses execution logs and conversation turns
- Formats tool usage and results
- Adds formatted report to GitHub step summary

#### **Security Cleanup:**
- Revokes GitHub App installation token
- Cleans up temporary files and processes

## Security Considerations

### **Access Control:**
- Repository-scoped permissions only
- Write access validation for actors
- Bot user controls and allowlists

### **Token Management:**
- Short-lived installation tokens
- Automatic token revocation after use
- Secure OIDC-based exchange

### **Permission Boundaries:**
- Limited to configured GitHub App permissions
- No cross-repository access
- Scoped to specific repository operations

## Integration Points

### **With Pullfrog:**
The Claude Code Action can be integrated with Pullfrog's workflow system, providing:
- Standardized agent interaction patterns
- Consistent GitHub integration
- Reusable authentication flows
- Common MCP server infrastructure

### **With GitHub:**
- Native GitHub Actions integration
- Comprehensive API coverage (REST + GraphQL)
- Proper webhook handling
- Standard GitHub UI integration

## Development Notes

### **Key Files:**
- `src/entrypoints/prepare.ts`: Main preparation logic
- `src/modes/`: Mode detection and handling
- `src/github/token.ts`: OIDC token exchange
- `src/mcp/`: MCP server implementations
- `base-action/`: Core Claude Code execution

### **Testing:**
- Unit tests for individual components
- Integration tests for full workflows
- Local testing with `act` tool
- Comprehensive fixture support

This architecture provides a robust, secure, and extensible foundation for Claude-GitHub integration while maintaining clear separation of concerns and comprehensive error handling.
