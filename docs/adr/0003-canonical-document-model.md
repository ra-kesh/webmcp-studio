# ADR 0003: Canonical document model outside Fabric

Status: accepted, 2026-08-26.

## Context

The UI, WebMCP tools, REST API, renderer, undo history, validation, and publishing need one stable contract. Saving Fabric JSON would tie all of them to a UI library's serialization and runtime behavior.

## Decision

Store a versioned, pure TypeScript document. Typed commands are the only write path. Fabric projects document nodes for interaction and translates gestures back into commands.

## Consequences

The same document works in React and Workers. Tests can validate field propagation without a browser. The Fabric adapter requires deliberate conversion code, but changing or upgrading the canvas engine no longer requires migrating the public template contract.
