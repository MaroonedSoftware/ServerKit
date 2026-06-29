# @maroonedsoftware/comms

## 0.2.0

### Minor Changes

- fe8ec2c: Add `@maroonedsoftware/comms`: a channel-agnostic messaging core. Define a `command` / `action` / `message` handler once on a `ChannelRouter` and run it on every wired channel, replying through a uniform `Reply`. Includes a `TemplateRegistry` for rich, per-channel outbound (with a portable default and a `sendNative` escape hatch), a `Notifier` seam for proactive sends, and `CommsError`. The core is channel-free — each chat package exposes a `./comms` adapter that binds to it via an optional peer dependency.
