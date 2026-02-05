---
id: frontend-modifier
name: Frontend Code Modifier
description: Skill for understanding and modifying the OlliBot React frontend. Use this when asked to make changes to the UI, add components, modify styles, or update frontend functionality.
---

# Frontend Code Modifier Skill

This skill provides comprehensive knowledge for modifying the OlliBot React frontend codebase. The frontend uses React 19 with Vite for development and hot module reloading.

## Technology Stack

- **React 19.1.0** - Latest React with concurrent features
- **React Router 7** - Client-side routing
- **Vite** - Build tool with HMR (Hot Module Reloading)
- **React Compiler** - Automatic memoization via babel-plugin-react-compiler
- **CSS** - Plain CSS (no CSS-in-JS or preprocessors)

## Frontend Directory Structure

```
/web/
├── index.html              # Entry HTML file
├── vite.config.js          # Vite configuration (proxies, HMR settings)
├── package.json            # Frontend dependencies
└── src/
    ├── main.jsx            # React app entry point
    ├── App.jsx             # Main application component (90KB - large monolithic file)
    ├── styles.css          # Global stylesheet (85KB - unified styles)
    ├── components/         # Reusable UI components
    │   ├── ChatInput.jsx       # User input with voice support
    │   ├── SourcePanel.jsx     # Citation sources display
    │   ├── BrowserPreview.jsx  # Live browser automation preview
    │   ├── BrowserSessions.jsx # Browser session management
    │   ├── HtmlPreview.jsx     # HTML content rendering
    │   ├── RAGProjects.jsx     # RAG document management UI
    │   ├── ClickOverlay.jsx    # Click interaction overlay
    │   └── eval/               # Evaluation mode components
    │       ├── EvalRunner.jsx
    │       ├── EvalResults.jsx
    │       ├── EvalJsonEditor.jsx
    │       └── EvalSidebar.jsx
    ├── hooks/              # Custom React hooks
    │   ├── useWebSocket.js     # WebSocket connection management
    │   └── useVoiceToText.js   # Voice-to-text transcription
    ├── contexts/           # React contexts
    │   └── AppContext.js       # Global app state
    ├── utils/              # Utility functions
    │   └── helpers.js          # Helper functions
    └── worklets/           # Audio worklets
        └── vad-processor.js    # Voice activity detection
```

## Key Files and Their Responsibilities

### App.jsx (Main Application)
The central hub of the application containing:
- Conversation state management
- Message rendering logic
- WebSocket event handling
- Route definitions
- Panel layouts (sources, browser preview, RAG)
- Theme and settings state

**Important patterns in App.jsx:**
- Uses `useWebSocket` hook for real-time communication
- Manages conversation list and current conversation
- Handles agent delegation events and tool events
- Renders markdown with syntax highlighting

### ChatInput.jsx (User Input Component)
Handles:
- Text input with auto-resize
- Voice input integration
- File attachments
- Command suggestions
- Submit handling

### SourcePanel.jsx (Citations Display)
Displays citation sources from:
- Web searches
- Wikipedia queries
- RAG document retrieval
- Tool execution results

### styles.css (Global Styles)
CSS organization:
- CSS variables for theming at `:root`
- Component-scoped classes (`.chat-input`, `.message`, etc.)
- Responsive breakpoints
- Dark/light mode support via CSS variables
- Animation keyframes

## Build System

### Development Commands
```bash
# Start Vite dev server with HMR (port 5173)
cd web && npm run dev

# Or from project root
npm run dev:web
```

### Build Commands
```bash
# Build for production
cd web && npm run build

# Preview production build
cd web && npm run preview
```

### Verifying Changes
After making changes, verify the build succeeds:
```bash
cd /web && npm run build
```

The Vite dev server will automatically reload when files change (HMR). For most component changes, the page will update without a full refresh.

## Making Changes - Best Practices

### 1. Adding a New Component

Create a new file in `/web/src/components/`:
```jsx
// Example: /web/src/components/NewComponent.jsx
export default function NewComponent({ prop1, prop2 }) {
  return (
    <div className="new-component">
      {/* Component content */}
    </div>
  );
}
```

Add styles to `/web/src/styles.css`:
```css
.new-component {
  /* component styles */
}
```

Import in App.jsx or parent component:
```jsx
import NewComponent from './components/NewComponent';
```

### 2. Modifying Existing Components

When editing existing components:
1. Identify the exact location of the code to change
2. Make minimal, targeted changes
3. Preserve existing prop interfaces
4. Maintain backwards compatibility
5. Add new CSS classes rather than modifying existing ones

### 3. Adding New Styles

Add new CSS at the end of the relevant section in styles.css:
```css
/* ============ NEW COMPONENT STYLES ============ */
.my-new-style {
  /* styles */
}
```

Use CSS variables for theming:
```css
.my-component {
  color: var(--text-color);
  background: var(--bg-color);
}
```

### 4. Adding New Hooks

Create in `/web/src/hooks/`:
```jsx
// /web/src/hooks/useMyHook.js
import { useState, useEffect } from 'react';

export function useMyHook(initialValue) {
  const [state, setState] = useState(initialValue);

  useEffect(() => {
    // Effect logic
  }, []);

  return [state, setState];
}
```

## Code Style Guidelines

1. **Functional Components Only** - Use function components with hooks
2. **Named Exports for Hooks** - `export function useMyHook()`
3. **Default Exports for Components** - `export default function MyComponent()`
4. **Descriptive Class Names** - Use BEM-like naming (e.g., `message-content__header`)
5. **No Inline Styles** - Use CSS classes
6. **Props Destructuring** - Destructure props in function parameters

## Common Patterns

### WebSocket Integration
```jsx
import { useWebSocket } from './hooks/useWebSocket';

function MyComponent() {
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket('/ws');

  // Handle incoming messages
  useEffect(() => {
    if (lastMessage) {
      // Process message
    }
  }, [lastMessage]);
}
```

### State Management
The app uses React's built-in state management:
- `useState` for local state
- `useContext` for shared state
- No Redux or external state library

### Routing
```jsx
import { useNavigate, useParams } from 'react-router-dom';

function MyComponent() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
}
```

## Safety Guidelines

1. **Never delete critical files** - App.jsx, main.jsx, index.html
2. **Backup before major changes** - Git commit before large modifications
3. **Test incrementally** - Make small changes and verify each one
4. **Preserve exports** - Don't remove exports that other files depend on
5. **Check imports** - Ensure new imports resolve correctly

## Hot Module Reloading (HMR)

Vite provides instant updates during development:
- **Component changes** - Hot reload (preserves state when possible)
- **CSS changes** - Instant style injection
- **Hook changes** - Full page reload (state reset)
- **Context changes** - Full page reload

If HMR fails, manually refresh the browser.

## Troubleshooting

### Build Errors
```bash
# Check for syntax errors
cd web && npm run build 2>&1 | head -50

# Check dependencies
cd web && npm install
```

### Common Issues
1. **Import not found** - Check file path and export
2. **Component not rendering** - Check if imported and used correctly
3. **Styles not applying** - Check class name spelling, CSS specificity
4. **HMR not working** - Check Vite console for errors

## File Size Awareness

- `App.jsx` is ~90KB - be careful with large changes
- `styles.css` is ~85KB - append new styles at end of relevant sections
- Consider component extraction for new features rather than bloating App.jsx
