# <module name>

Copy this file to `api/src/modules/<name>/README.md` and fill in every section. CI (`npm run check:module-readmes -w api`) fails when a module directory has no non-empty `README.md`. Keep it current when the public interface changes (Definition of Done, issue #16 §9.4).

## Responsibility

One or two sentences: what this module owns and why it exists.

## Public interface

Only what `index.ts` exports. Other modules and the HTTP layer may use nothing else (ADR 0012).

- Service methods: `methodName(input): result` with a one-line description each.
- Events published: `event.name` (payload type in `src/ports/event-bus.ts`).
- Events consumed: `event.name` and what the handler does (idempotent, at-least-once).
- Ports used: the interfaces from `src/ports/` this module depends on.

## Owned data

Collections (or storage areas) this module is the only writer of, with the key fields and indexes it relies on.

## Non-goals

What this module deliberately does not do, and which module does it instead.
