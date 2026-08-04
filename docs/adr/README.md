# Architecture Decision Records (ADR)

This directory contains the Architecture Decision Records (ADRs) of the project.

## Purpose

ADRs document important architectural decisions made during the development process.

Each ADR explains:

- The problem that needed to be solved.
- The decision that was made.
- The alternatives that were considered (if applyed).
- The consequences of that decision.

The goal is to preserve the project's architectural history and provide context for future development.

---

## ADR Guidelines

- Each ADR should describe only one architectural decision.
- ADRs should never be deleted.
- Once an ADR is accepted, it should not be rewritten.
- If a decision changes in the future, create a new ADR that supersedes the previous one.
- Keep ADRs concise and focused.

---

## Naming Convention

Files must follow this format:

`NNNN-short-description.md`

Examples:

`0001-record-architecture-decisions.md`
`0002-css-framework-choice.md`
`0003-database-selection.md`

The number represents the chronological order in which decisions were made.

---

## ADR Status

Possible statuses:

| Status | Description |
|---|---|
| Proposed | Decision is being discussed |
| Accepted | Decision was approved and implemented |
| Rejected | Decision was considered but not chosen |
| Deprecated | Decision is no longer recommended |
| Superseded | Decision was replaced by a newer ADR |

---

## Creating a New ADR

1. Copy `TEMPLATE.md`.
2. Assign the next available number.
3. Describe the context and problem.
4. Document alternatives.
5. Explain the final decision.
6. Review with the team.
7. Change the status to `Accepted` once approved.

---
