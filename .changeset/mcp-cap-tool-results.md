---
'@maroonedsoftware/mcp': minor
---

Add `capToolResults(tools, { maxChars })` and `CappedToolHandler`, which cut a tool result whose text runs past `maxChars` and end it with `… [cut at N of M characters: ask for less: a narrower search or filter, a smaller limit, or the next page]`, so the model narrows its call instead of answering from part of the data. A cut result drops `structuredContent`, and is marked `isError` when the tool declares an `outputSchema`. A result within the cap is returned unchanged.
