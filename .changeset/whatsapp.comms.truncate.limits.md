---
'@maroonedsoftware/whatsapp': patch
---

The `./comms` notifier now truncates portable messages to the WhatsApp Cloud API limits instead of letting Meta refuse the send: a text body to 4096 characters, an interactive body to 1024, a reply button title to 20, and a list row title to 24. A cut ends in an ellipsis and never splits an emoji.
