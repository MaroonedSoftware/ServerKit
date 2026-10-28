---
'@maroonedsoftware/mcp': patch
---

`McpHelpToolHandler` now advertises `annotations: { readOnlyHint: true }`, so clients treat calling the help tool as a read rather than a write.
