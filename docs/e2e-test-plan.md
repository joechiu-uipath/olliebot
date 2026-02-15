# OllieBot E2E Test Plan

This document organizes end-to-end test cases for OllieBot from two perspectives:
1. **Feature-based**: User-facing functionality
2. **Functional Area-based**: Technical/architectural components

---

## Part 1: Feature-Based Test Suites

### Suite: Chat & Conversations

| ID | Test Case | Description |
|----|-----------|-------------|
| CHAT-001 | Send simple message | User sends a text message and receives a response |
| CHAT-002 | Streaming response | Response streams token-by-token to UI |
| CHAT-003 | Message with image attachment | Send message with image attachment |
| CHAT-004 | Conversation persistence | Messages persist after page refresh |
| CHAT-005 | Create new conversation | Start a new conversation |
| CHAT-006 | Switch conversations | Switch between existing conversations |
| CHAT-007 | Delete conversation | Delete a conversation and verify removal |
| CHAT-008 | Rename conversation | Manually rename a conversation |
| CHAT-009 | Auto-naming | Conversation auto-named after threshold messages |
| CHAT-010 | Clear conversation messages | Clear messages while keeping conversation |
| CHAT-011 | Message history pagination | Load older messages on scroll |
| CHAT-012 | Feed conversation | Scheduled tasks appear in Feed |
| CHAT-013 | Delegation display | Delegation events render correctly |
| CHAT-014 | Tool execution display | Tool calls show parameters and results |
| CHAT-015 | Error message display | Errors render with details |
| CHAT-016 | Citations display | Source citations render and are clickable |
| CHAT-017 | Think mode toggle | Toggle Think mode via # in input |
| CHAT-018 | Think+ mode toggle | Toggle Think+ (extended thinking) mode |
| CHAT-019 | Deep Research mode toggle | Toggle Deep Research mode via # |
| CHAT-020 | Inline conversation rename | Edit conversation name directly in sidebar |
| CHAT-021 | Hashtag menu | # shows command menu with modes and agents |
| CHAT-022 | Agent command chip | Selected agent command shows as removable chip |
| CHAT-023 | Scroll-to-bottom button | Button appears when scrolled up, clicks to scroll down |
| CHAT-024 | Streaming cursor | Blinking cursor during response streaming |
| CHAT-025 | Token usage display | Input/output tokens shown after response |

### Suite: Agent Delegation

| ID | Test Case | Description |
|----|-----------|-------------|
| AGENT-001 | Delegate to researcher | Supervisor delegates research task to researcher agent |
| AGENT-002 | Delegate to coder | Supervisor delegates coding task to coder agent |
| AGENT-003 | Delegate to writer | Supervisor delegates writing task to writer agent |
| AGENT-004 | Delegate to planner | Supervisor delegates planning task to planner agent |
| AGENT-005 | Command trigger (#research) | `#research` triggers direct delegation |
| AGENT-006 | Command trigger (#code) | `#code` triggers direct delegation |
| AGENT-007 | No re-delegation | Verify supervisor doesn't re-delegate same task |
| AGENT-008 | Delegation notification | UI shows delegation card when agent is spawned |
| AGENT-009 | Worker response attribution | Worker responses show correct agent name/emoji |
| AGENT-010 | Parallel delegation | Multiple agents work in parallel |
| AGENT-011 | Sub-agent delegation | Worker delegates to sub-agents |
| AGENT-012 | Delegation chain | Multi-level delegation (supervisor -> lead -> worker) |

### Suite: Scheduled Tasks

| ID | Test Case | Description |
|----|-----------|-------------|
| TASK-001 | List tasks | View all scheduled tasks |
| TASK-002 | Run task manually | Trigger task execution via API/UI |
| TASK-003 | Task run event | Task run appears in Feed conversation |
| TASK-004 | Task tool restrictions | Task only uses allowed tools from config |
| TASK-005 | Enable/disable task | Toggle task active state |
| TASK-006 | Task schedule execution | Task runs at scheduled time (cron) |
| TASK-007 | Task lastRun tracking | lastRun timestamp updates after execution |
| TASK-008 | Task with conversationId | Task targets specific conversation |
| TASK-009 | No duplicate task messages | Single message per task run after refresh |
| TASK-010 | Task markdown parsing | Task .md file parsed to JSON config |
| TASK-011 | Task hot-reload | Task updates without server restart |

### Suite: Browser Automation

| ID | Test Case | Description |
|----|-----------|-------------|
| BROWSER-001 | Create browser session | Launch new browser session via browser_session tool |
| BROWSER-002 | Navigate to URL | Navigate browser via browser_navigate tool |
| BROWSER-003 | Take screenshot | Capture browser screenshot via browser_screenshot tool |
| BROWSER-004 | Browser action - click | Click element via browser_action tool |
| BROWSER-005 | Browser action - type | Type text into input field |
| BROWSER-006 | Browser action - scroll | Scroll page |
| BROWSER-007 | Close session | Close browser session via DELETE /api/browser/sessions/:id |
| BROWSER-008 | List sessions | View all active browser sessions |
| BROWSER-009 | DOM strategy | Use CSS selector-based interaction |
| BROWSER-010 | Computer Use strategy | Use screenshot + coordinate clicking |
| BROWSER-011 | Session timeout | Inactive session cleans up |
| BROWSER-012 | Multiple sessions | Run multiple browser sessions |
| BROWSER-013 | Live preview | Browser preview shown in UI (debug mode) |
| BROWSER-014 | Session thumbnail | Session shows thumbnail in sidebar accordion |
| BROWSER-015 | Session status badge | Status badge shows active/busy/idle/error |
| BROWSER-016 | Preview modal | Click session opens live preview modal |
| BROWSER-017 | Close from modal | Close button in modal closes session |

### Suite: Desktop Automation (Windows Sandbox)

| ID | Test Case | Description |
|----|-----------|-------------|
| DESKTOP-001 | Create desktop session | Launch Windows Sandbox via desktop_session tool |
| DESKTOP-002 | VNC connection | Successfully connect to sandbox VNC |
| DESKTOP-003 | Take screenshot | Capture desktop screenshot via desktop_screenshot tool |
| DESKTOP-004 | Desktop action - click | Click at coordinates via desktop_action tool |
| DESKTOP-005 | Desktop action - type | Send keystrokes |
| DESKTOP-006 | Desktop action - drag | Mouse drag operation |
| DESKTOP-007 | Close session | Clean shutdown via DELETE /api/desktop/sessions/:id |
| DESKTOP-008 | IP discovery | Correctly discover sandbox IP from shared folder |
| DESKTOP-009 | Session recovery | Handle VNC reconnection after brief disconnect |
| DESKTOP-010 | Tool message status | Tool messages marked failed on session close |
| DESKTOP-011 | Session thumbnail | Session shows thumbnail in sidebar accordion |
| DESKTOP-012 | Session status badge | Status badge shows provisioning/active/error |
| DESKTOP-013 | Preview modal | Click session opens live preview modal |
| DESKTOP-014 | Viewport dimensions | Modal shows viewport dimensions |
| DESKTOP-015 | Platform icon | Modal shows platform icon (Windows/macOS/Linux) |

### Suite: Tools - Web & Search

| ID | Test Case | Description |
|----|-----------|-------------|
| TOOL-WEB-001 | Web search | Execute web_search and return results |
| TOOL-WEB-002 | Web scrape | Scrape content from URL via web_scrape |
| TOOL-WEB-003 | Wikipedia search | Search Wikipedia via wikipedia_search |
| TOOL-WEB-004 | HTTP client | Make HTTP requests via http_client |
| TOOL-WEB-005 | Website crawler | Crawl multiple pages via website_crawler |

### Suite: Tools - Code Execution

| ID | Test Case | Description |
|----|-----------|-------------|
| TOOL-CODE-001 | Run Python (Pyodide) | Execute Python code with pyodide engine |
| TOOL-CODE-002 | Run Python (Monty) | Execute Python with monty engine |
| TOOL-CODE-003 | Python with packages | Load numpy/pandas/matplotlib |
| TOOL-CODE-004 | Python file output | Python generates image file |
| TOOL-CODE-005 | Generate Python | Generate Python code via generate_python |

### Suite: Tools - Media & Output

| ID | Test Case | Description |
|----|-----------|-------------|
| TOOL-MEDIA-001 | Create image | Generate image via create_image tool |
| TOOL-MEDIA-002 | Speak (TTS) | Generate speech audio via speak tool |
| TOOL-MEDIA-003 | Take screenshot | Capture screen via take_screenshot |

### Suite: Tools - Memory & Context

| ID | Test Case | Description |
|----|-----------|-------------|
| TOOL-MEM-001 | Remember | Store memory via remember tool |
| TOOL-MEM-002 | Memory retrieval | Stored memory retrieved in future context |
| TOOL-MEM-003 | Memory persistence | Memory survives server restart |

### Suite: Tools - System

| ID | Test Case | Description |
|----|-----------|-------------|
| TOOL-SYS-001 | Delegate tool | Spawn sub-agent via delegate tool |
| TOOL-SYS-002 | Query RAG project | Query indexed documents |
| TOOL-SYS-003 | Tool event broadcast | Tool execution events reach UI |
| TOOL-SYS-004 | Tool result persistence | Tool results persist after refresh |
| TOOL-SYS-005 | Tool progress updates | Long-running tools show progress |
| TOOL-SYS-006 | Tool file output | Tools that produce files display correctly |

### Suite: User-Defined Tools

| ID | Test Case | Description |
|----|-----------|-------------|
| USERTOOL-001 | Create tool from markdown | System generates .js from .md definition |
| USERTOOL-002 | Execute user tool | Execute user-defined tool |
| USERTOOL-003 | Tool hot-reload | Tool updates on .md file change |
| USERTOOL-004 | Tool input validation | Zod validation rejects invalid input |
| USERTOOL-005 | Tool sandbox execution | Tool runs in VM sandbox |
| USERTOOL-006 | Tool conflict with native | User tool doesn't override native tool |

### Suite: MCP Integration

| ID | Test Case | Description |
|----|-----------|-------------|
| MCP-001 | Server connection | Connect to MCP server on startup |
| MCP-002 | Tool discovery | List tools from MCP server |
| MCP-003 | Tool execution | Execute MCP tool |
| MCP-004 | Server enable/disable | Toggle MCP server via settings |
| MCP-005 | Server reconnection | Reconnect after MCP server restart |
| MCP-006 | Tool whitelist/blacklist | Filter MCP tools by config |
| MCP-007 | MCP toggle in sidebar | Enable/disable MCP via sidebar toggle |
| MCP-008 | MCP connection status | Sidebar shows connecting/connected/disconnected |
| MCP-009 | MCP tool count | Sidebar shows tool count per server |

### Suite: Self-Coding

| ID | Test Case | Description |
|----|-----------|-------------|
| SELFCODE-001 | Read frontend code | Read file via read_frontend_code tool |
| SELFCODE-002 | List frontend directory | List directory contents |
| SELFCODE-003 | Create file | Create new file via modify_frontend_code |
| SELFCODE-004 | Edit file - replace | Replace text in file |
| SELFCODE-005 | Edit file - insert | Insert text at line number |
| SELFCODE-006 | Delete file | Delete file (non-protected) |
| SELFCODE-007 | Protected file delete blocked | Cannot delete main.jsx, package.json, etc. |
| SELFCODE-008 | Check frontend build | Validate via check_frontend_code |
| SELFCODE-009 | Coding workflow delegation | Supervisor -> Coding Lead -> Planner -> Worker |
| SELFCODE-010 | Code fixer on build failure | Code Fixer auto-fixes build errors |
| SELFCODE-011 | Path sandboxing | Operations restricted to /web directory |

### Suite: Missions

| ID | Test Case | Description |
|----|-----------|-------------|
| MISSION-001 | List missions | View all missions via API |
| MISSION-002 | View mission details | See mission pillars, todos, metrics |
| MISSION-003 | Pause mission | Pause active mission |
| MISSION-004 | Resume mission | Resume paused mission |
| MISSION-005 | Create todo | Create todo via mission_todo_create tool |
| MISSION-006 | Complete todo | Mark todo complete via mission_todo_complete |
| MISSION-007 | Update todo | Update todo via mission_todo_update |
| MISSION-008 | Record metric | Record metric via mission_metric_record |
| MISSION-009 | Update dashboard | Update dashboard via mission_update_dashboard |
| MISSION-010 | Mission cycle | Trigger mission cycle |
| MISSION-011 | Pillar strategies | View pillar strategies |
| MISSION-012 | Mission mode UI | Switch to Mission mode via mode switcher |
| MISSION-013 | Mission sidebar selection | Select mission from sidebar |
| MISSION-014 | Pillar selection | Select pillar within mission |
| MISSION-015 | Mission tabs | Switch between dashboard/pillars/config tabs |
| MISSION-016 | Pillar tabs | Switch between metrics/strategies tabs |
| MISSION-017 | Mission chat panel | Collapsible chat panel with resize |
| MISSION-018 | Mission chat badge | New message badge when chat collapsed |

### Suite: Dashboards

| ID | Test Case | Description |
|----|-----------|-------------|
| DASH-001 | Create dashboard snapshot | POST /api/dashboards/snapshots creates snapshot |
| DASH-002 | List dashboard snapshots | GET /api/dashboards/snapshots lists all |
| DASH-003 | Get dashboard snapshot | GET /api/dashboards/snapshots/:id returns snapshot |
| DASH-004 | Render dashboard | POST /api/dashboards/snapshots/:id/render generates HTML |
| DASH-005 | Re-render dashboard | POST /api/dashboards/snapshots/:id/rerender regenerates |
| DASH-006 | Delete dashboard | DELETE /api/dashboards/snapshots/:id removes |
| DASH-007 | Pillar dashboard | Pillar-specific dashboard rendering |
| DASH-008 | Dashboard HTML output | Generated HTML includes KPIs, trends, badges |

### Suite: RAG Projects

| ID | Test Case | Description |
|----|-----------|-------------|
| RAG-001 | Query RAG project | Query indexed documents via query_rag_project |
| RAG-002 | RAG results in citations | RAG results appear as citation sources |
| RAG-003 | Multiple projects | Query different RAG projects |
| RAG-004 | Upload document | Upload file via POST /api/rag/projects/:id/upload |
| RAG-005 | Drag-drop upload | Drag-drop file onto RAG project in sidebar |
| RAG-006 | Indexing progress | Indexing progress bar shows percentage |
| RAG-007 | Force re-index | Ctrl+click index button forces full re-index |
| RAG-008 | Indexing WebSocket events | rag_indexing_started/progress/completed events |
| RAG-009 | Document retrieval | GET /api/rag/projects/:id/documents/:filename |
| RAG-010 | Supported extensions | GET /api/rag/supported-extensions returns list |
| RAG-011 | Document count display | Shows indexed vs total document count |

### Suite: Skills

| ID | Test Case | Description |
|----|-----------|-------------|
| SKILL-001 | List skills | View available skills via API |
| SKILL-002 | Read skill | Read skill content via read_agent_skill tool |
| SKILL-003 | Run skill script | Execute skill script via run_agent_skill_script |
| SKILL-004 | Skill hot-reload | Skill updates without restart |
| SKILL-005 | Built-in skills | Access built-in skills (frontend-modifier) |

### Suite: Deep Research

| ID | Test Case | Description |
|----|-----------|-------------|
| RESEARCH-001 | Initiate deep research | Start multi-step research via # toggle |
| RESEARCH-002 | Research lead delegation | Supervisor delegates to deep-research-lead |
| RESEARCH-003 | Research worker spawning | Lead spawns research workers |
| RESEARCH-004 | Research report generation | Final report generated |
| RESEARCH-005 | Research plan event | deep_research_plan WebSocket event received |
| RESEARCH-006 | Research step events | deep_research_step events show progress |
| RESEARCH-007 | Research source events | deep_research_source events list sources |
| RESEARCH-008 | Research draft event | deep_research_draft event shows draft |
| RESEARCH-009 | Research review event | deep_research_review event shows feedback |
| RESEARCH-010 | Research completion | deep_research_completed event with final report |

### Suite: Voice Input

| ID | Test Case | Description |
|----|-----------|-------------|
| VOICE-001 | Voice mode toggle | Enable/disable voice mode via button |
| VOICE-002 | Hover-to-talk | Hovering voice button starts recording when voice mode on |
| VOICE-003 | Push-to-talk release | Releasing mouse submits transcribed message |
| VOICE-004 | Voice transcription | Audio transcribed to text correctly |
| VOICE-005 | Voice connection state | UI shows connecting/connected/recording states |
| VOICE-006 | Voice error handling | Voice errors display and auto-dismiss |
| VOICE-007 | Voice placeholder text | Input placeholder changes based on voice state |

### Suite: Web UI Interactions

| ID | Test Case | Description |
|----|-----------|-------------|
| WEBUI-001 | Resizable app width | Drag left edge to resize, persists to localStorage |
| WEBUI-002 | Mode switcher | Switch between Chat/Mission/Trace/Eval modes |
| WEBUI-003 | Sidebar accordions | Expand/collapse Tasks, Tools, MCPs, Skills sections |
| WEBUI-004 | Code block copy | Copy button on code blocks copies to clipboard |
| WEBUI-005 | HTML preview toggle | Toggle raw HTML vs rendered preview |
| WEBUI-006 | HTML execute button | Execute button runs scripts in sandboxed iframe |
| WEBUI-007 | HTML fullscreen | Fullscreen modal for HTML preview |
| WEBUI-008 | Audio player | Play button for audio content in messages |
| WEBUI-009 | PDF viewer modal | Click PDF citation opens PDF viewer |
| WEBUI-010 | Citation panel expand | Expand/collapse sources list in citations |
| WEBUI-011 | Message action buttons | Custom action buttons in messages clickable |
| WEBUI-012 | Computer Use accordion | Browser/Desktop sessions accordion in sidebar |
| WEBUI-013 | Session thumbnails | Live screenshots in session list |
| WEBUI-014 | Browser preview modal | Click session opens live preview modal |
| WEBUI-015 | Desktop preview modal | Click desktop session opens preview modal |
| WEBUI-016 | Mobile menu button | Hamburger menu opens sidebar on mobile |

### Suite: Evaluation System

| ID | Test Case | Description |
|----|-----------|-------------|
| EVAL-001 | List evaluations | View all evaluations via API |
| EVAL-002 | List suites | View evaluation suites |
| EVAL-003 | Run single evaluation | Run one evaluation via API |
| EVAL-004 | Run evaluation suite | Run full suite |
| EVAL-005 | View evaluation results | See results via API |
| EVAL-006 | Evaluation progress events | Progress updates via WebSocket |
| EVAL-007 | Baseline vs alternative | Compare two prompts |
| EVAL-008 | Statistical comparison | P-value and effect size calculated |
| EVAL-009 | Tool expectations | Verify expected tools called |
| EVAL-010 | Response expectations | Verify response contains required elements |
| EVAL-011 | Eval mode UI | Switch to Eval mode via mode switcher |
| EVAL-012 | Eval sidebar navigation | Navigate suites and results in sidebar |
| EVAL-013 | Eval result deep link | URL /eval/result/path opens specific result |
| EVAL-014 | List eval jobs | GET /api/eval/jobs lists running jobs |
| EVAL-015 | Eval history | GET /api/eval/history/:evaluationId shows runs |
| EVAL-016 | Generate eval report | POST /api/eval/report generates report |
| EVAL-017 | Cleanup results | POST /api/eval/cleanup removes old results |
| EVAL-018 | List prompts | GET /api/prompts/list returns prompt files |

### Suite: Citations

| ID | Test Case | Description |
|----|-----------|-------------|
| CITE-001 | Citation extraction from web_search | Web search results become citation sources |
| CITE-002 | Citation extraction from web_scrape | Scraped content becomes citation source |
| CITE-003 | Citation extraction from RAG | RAG results become citation sources |
| CITE-004 | Post-hoc citation generation | LLM generates citations after response |
| CITE-005 | Citation display in UI | Citations rendered with source links |
| CITE-006 | Citation persistence | Citations saved with message |

### Suite: Settings

| ID | Test Case | Description |
|----|-----------|-------------|
| SETTINGS-001 | Get settings | Retrieve current settings via API |
| SETTINGS-002 | Update settings | Modify settings via API |
| SETTINGS-003 | Settings persistence | Settings survive restart |

### Suite: Tracing & Logs

| ID | Test Case | Description |
|----|-----------|-------------|
| TRACE-001 | List traces | View traces via API |
| TRACE-002 | View trace detail | See spans, LLM calls, tool calls |
| TRACE-003 | List LLM calls | View LLM calls via API |
| TRACE-004 | View LLM call detail | See full request/response |
| TRACE-005 | List tool calls | View tool calls via API |
| TRACE-006 | Trace stats | Get token usage stats |
| TRACE-007 | Filter by conversation | Filter traces by conversationId |
| TRACE-008 | Trace timeline | View agent execution timeline |
| TRACE-009 | Cross-link Chat to Logs | Navigate from chat to logs |
| TRACE-010 | Logs mode UI | Switch to Logs mode via mode switcher |
| TRACE-011 | Traces vs LLM Calls view | Toggle between view modes |
| TRACE-012 | Workload filter | Filter traces by workload dropdown |
| TRACE-013 | Status filter | Filter traces by status dropdown |
| TRACE-014 | Real-time polling | New traces appear via polling |
| TRACE-015 | Trace deep link | URL ?traceId= opens specific trace |
| TRACE-016 | Token reduction stats | Token reduction metrics in stats |

### Suite: Multi-Channel

| ID | Test Case | Description |
|----|-----------|-------------|
| CHANNEL-001 | Web UI channel | Messages work via web UI |
| CHANNEL-002 | Console CLI channel | Messages work via console |
| CHANNEL-003 | TUI channel | Messages work via terminal UI |

### Suite: TUI (Terminal UI)

| ID | Test Case | Description |
|----|-----------|-------------|
| TUI-001 | Focus cycling | Tab cycles through input/sidebar/chat |
| TUI-002 | Sidebar toggle | Ctrl+B shows/hides sidebar |
| TUI-003 | Sidebar arrow navigation | Arrow keys navigate sidebar items |
| TUI-004 | Sidebar accordion expand | Enter expands/collapses accordions |
| TUI-005 | Conversation selection | Select conversation from sidebar |
| TUI-006 | Task run from sidebar | Run task directly from sidebar |
| TUI-007 | Chat scrolling | Arrow/vim keys scroll chat area |
| TUI-008 | Page up/down | Page Up/Down scroll chat |
| TUI-009 | Auto-scroll on new message | Chat scrolls to bottom on new message |
| TUI-010 | Tool result expand | Expand/collapse tool results |
| TUI-011 | Input cursor movement | Arrow keys move cursor in input |
| TUI-012 | Input Ctrl+A/E | Jump to start/end of input |
| TUI-013 | Slash menu open | / at input start opens command menu |
| TUI-014 | Slash menu navigation | Arrow keys navigate slash menu |
| TUI-015 | Slash menu select | Enter selects slash command |
| TUI-016 | Slash /new | /new creates new conversation |
| TUI-017 | Slash /switch | /switch opens conversation list |
| TUI-018 | Slash /tasks | /tasks toggles tasks panel |
| TUI-019 | Slash /tools | /tools toggles tools panel |
| TUI-020 | Slash /mcp | /mcp toggles MCPs panel |
| TUI-021 | Markdown headers | Headers render with color/bold |
| TUI-022 | Code blocks | Code blocks render with language tag |
| TUI-023 | Tool status icons | Tools show [OK]/[ERR]/[...] |
| TUI-024 | Tool source icons | Tools show [NAT]/[SKL]/[MCP] |
| TUI-025 | Progress bars | Tool progress bars display percentage |
| TUI-026 | Token stats display | Input/output tokens shown after response |
| TUI-027 | Connection status | Header shows Connected/Disconnected |
| TUI-028 | Focus indicator | Header shows current focus area |
| TUI-029 | Ctrl+C exit | Ctrl+C exits application |

---

## Part 2: Functional Area-Based Test Suites

### Suite: API Endpoints

| ID | Test Case | Description |
|----|-----------|-------------|
| API-001 | Health check | GET /health returns ok |
| API-002 | Startup info | GET /api/startup returns config |
| API-003 | Model capabilities | GET /api/model-capabilities returns supported features |
| API-004 | CORS headers | API returns proper CORS headers |
| API-005 | JSON parsing | API parses JSON bodies correctly |
| API-006 | Error responses | Errors return proper status codes and messages |
| API-007 | Pagination | List endpoints support pagination |
| API-008 | 404 handling | Unknown routes return 404 |

### Suite: WebSocket Communication

| ID | Test Case | Description |
|----|-----------|-------------|
| WS-001 | Connect | WebSocket connection established |
| WS-002 | Send message | Message sent via WebSocket processed |
| WS-003 | Receive stream | Streaming chunks received |
| WS-004 | Event types | All event types handled (message, stream_*, tool_*, delegation, task_run, error) |
| WS-005 | Reconnection | Client reconnects after disconnect |
| WS-006 | Multiple clients | Multiple clients receive broadcasts |
| WS-007 | Conversation subscription | Events filtered by conversationId |
| WS-008 | Log events | log_* events received for tracing |
| WS-009 | Connected event | 'connected' event sent on connection |
| WS-010 | Stream resume | stream_resume event on conversation switch |
| WS-011 | Tool resume | tool_resume event restores tool state |
| WS-012 | RAG indexing events | rag_indexing_started/progress/completed/error |
| WS-013 | RAG projects changed | rag_projects_changed event on project update |
| WS-014 | Task updated event | task_updated event on task status change |
| WS-015 | Deep research events | deep_research_* events for research progress |
| WS-016 | Play audio event | play_audio event for TTS playback |

### Suite: Database Persistence

| ID | Test Case | Description |
|----|-----------|-------------|
| DB-001 | Message create | Messages saved to database |
| DB-002 | Message query | Messages retrieved correctly |
| DB-003 | Conversation create | Conversations created |
| DB-004 | Conversation query | Conversations listed with metadata |
| DB-005 | Index performance | Queries use indexes efficiently |
| DB-006 | Trace persistence | Traces saved to database |
| DB-007 | LLM call persistence | LLM calls logged to database |
| DB-008 | Concurrent access | Multiple writers don't corrupt data |

### Suite: LLM Integration

| ID | Test Case | Description |
|----|-----------|-------------|
| LLM-001 | Anthropic provider | Calls to Claude work |
| LLM-002 | OpenAI provider | Calls to GPT work |
| LLM-003 | Google provider | Calls to Gemini work |
| LLM-004 | Azure OpenAI provider | Calls to Azure OpenAI work |
| LLM-005 | Streaming | Token streaming works |
| LLM-006 | Tool calling | LLM can call tools |
| LLM-007 | Vision (images) | Image inputs processed |
| LLM-008 | Model switching | Fast model vs main model used correctly |
| LLM-009 | Error handling | API errors handled gracefully |
| LLM-010 | Rate limiting | Retries on rate limits |
| LLM-011 | Extended thinking | Extended thinking mode works (Anthropic) |
| LLM-012 | Reasoning effort | Reasoning effort parameter applied |
| LLM-013 | Token reduction | Token reduction compresses context when enabled |
| LLM-014 | Token reduction stats | Compression metrics tracked in traces |
| LLM-015 | Token reduction cache | Compression cache prevents re-compression |

### Suite: Agent System

| ID | Test Case | Description |
|----|-----------|-------------|
| AGSYS-001 | Supervisor message handling | Supervisor processes incoming messages |
| AGSYS-002 | Worker tool loop | Worker executes tools in agentic loop |
| AGSYS-003 | Message deduplication | Duplicate messages not processed twice |
| AGSYS-004 | Delegation mutex | No race conditions in delegation tracking |
| AGSYS-005 | Conversation context | Correct history loaded for context |
| AGSYS-006 | Agent state tracking | Agent status (idle, working) tracked |
| AGSYS-007 | Well-known conversations | Feed and other special conversations work |
| AGSYS-008 | Agent registry | Specialist templates loaded correctly |
| AGSYS-009 | Agent capabilities | Capability-based tool filtering |

### Suite: Message Event System

| ID | Test Case | Description |
|----|-----------|-------------|
| EVT-001 | Tool event broadcast | Tool events reach WebSocket clients |
| EVT-002 | Tool event persistence | Tool events saved to database |
| EVT-003 | Delegation event broadcast | Delegation events reach clients |
| EVT-004 | Delegation event persistence | Delegation events saved |
| EVT-005 | Task run broadcast | Task run events reach clients |
| EVT-006 | Task run persistence | Task run message persisted via handleMessage |
| EVT-007 | Error event | Error events broadcast and persist |
| EVT-008 | Event ordering | Events arrive in correct order |

### Suite: Configuration & Initialization

| ID | Test Case | Description |
|----|-----------|-------------|
| CONFIG-001 | Env validation | Invalid env vars caught at startup |
| CONFIG-002 | Config file loading | MCP_SERVERS JSON parsed correctly |
| CONFIG-003 | Hot-reload tasks | Task changes detected and reloaded |
| CONFIG-004 | Hot-reload tools | User tool changes detected and reloaded |
| CONFIG-005 | Hot-reload skills | Skill changes detected and reloaded |
| CONFIG-006 | Git versioning | Config changes committed to git |

### Suite: Error Handling & Recovery

| ID | Test Case | Description |
|----|-----------|-------------|
| ERR-001 | LLM API error | Graceful handling of LLM errors |
| ERR-002 | Tool execution error | Failed tools don't crash agent |
| ERR-003 | WebSocket disconnect | UI handles disconnect gracefully |
| ERR-004 | Database error | DB errors logged, not crash |
| ERR-005 | Invalid input | Bad API input returns error |
| ERR-006 | Timeout handling | Long operations timeout gracefully |
| ERR-007 | MCP server failure | MCP errors don't crash application |
| ERR-008 | Browser session crash | Browser crash handled gracefully |
| ERR-009 | Desktop session crash | Sandbox crash handled gracefully |
