# ADR-NNNN - MariaDB vs. PostgreSQL

**Status:** Decided

**Date:** 02-08-2026

**Author(s):** cmoura-p / Claudia Pickett

---

## Context

Both MariaDB and PostgreSQL are SQL-based relational database management systems and are suitable for the DAKA project.

PostgreSQL is often considered a more feature-rich database system and is widely recommended for professional projects. It provides a broad range of advanced data types, such as:

`ARRAY` `JSONB` `UUID` `ENUM` `INET` `CIDR` `RANGE`

These additional data types are not, by themselves, the reason for this decision. The main point of interest for the DAKA project is **JSON support**, particularly in relation to the possibility of storing flexible item attributes.

It is important to note that **MariaDB also provides JSON support**.

### JSON fields

Consider an `listing` table with fields such as:

```text
id             INT
user_id        INT
category_id    INT
condition_id   INT
state_id       INT
title          TEXT
description    TEXT
wish           TEXT
```

A JSON field could provide a more structured and flexible way of storing item-specific attributes than a simple text description.

Same as a "wish list" field to describe what the user is looking for in exchange.

For example, attributes describing a book could be represented as:

```json
{
    "author": "Tolkien",
    "pages": 450,
    "language": "Portuguese"
}
```

While attributes describing a bicycle could be represented as:

```json
{
    "gears": 16,
    "weight": "2kg",
    "color": "blue"
}
```

This structure could make it possible to query specific attributes, such as finding all books by Tolkien or all items with a specific color.

One possible way of collecting these attributes would be to provide a category-specific form when an advertisement is created. The fields presented to the user could be determined by the product's category.

This approach could also be useful for future AI-based matching, where matches could be suggested based on item characteristics and user profiles.

### JSON vs. JSONB

PostgreSQL provides the `JSONB` data type in addition to `JSON`.

- `JSON` stores the JSON data while preserving its original textual representation.
- `JSONB` stores the data in an internal binary representation optimized for processing and querying.

A simple analogy is searching through a book versus searching through a book using an index.

For the DAKA project, JSON/JSONB support is therefore potentially useful, particularly if structured item attributes are later used for search, filtering, or AI-based matching.

---

## Decision

After evaluating the implementation complexity, project requirements, and available development time, the team decided to follow a **"keep it simple"** approach and use **MariaDB**.

MariaDB provides the SQL and JSON capabilities currently required by the project without introducing additional complexity at this stage.

The database schema and queries will therefore be implemented using MariaDB.

This decision does not prevent the project from using PostgreSQL in the future. The current database design will avoid unnecessary database-specific features where possible, making a future migration more manageable if PostgreSQL becomes necessary.

---

## Alternatives Considered

### Alternative 1 - PostgreSQL

Use PostgreSQL as the project's relational database management system.

**Advantages:**

- Rich set of native data types and advanced database features.
- Strong support for structured JSON data through `JSONB`.
- Well suited to complex querying and future data-intensive features.
- Widely used in professional and production environments.

**Disadvantages:**

- Additional complexity that is not currently required by the project.
- Some PostgreSQL-specific features could make future database portability more difficult.
- The current project requirements do not justify the additional complexity at this stage.

---

### Alternative 2 - MariaDB

Use MariaDB as the project's relational database management system.

**Advantages:**

- Satisfies the current relational database requirements.
- Supports JSON data.
- Familiar SQL-based interface.
- Simpler choice for the current project scope and timeline.
- Allows the team to focus on the application rather than on database-specific features that are not currently required.

**Disadvantages:**

- Does not provide PostgreSQL's `JSONB` data type.
- Some advanced PostgreSQL-specific features would not be available.
- A future migration to PostgreSQL may require some schema or query adjustments.

---

## Consequences

### Positive Consequences

- The project remains focused on its current requirements.
- Database implementation is kept simple.
- JSON support remains available for flexible item attributes.
- The team avoids introducing database-specific complexity that is not currently necessary.
- A future migration to PostgreSQL remains possible if project requirements change.

### Negative Consequences

- PostgreSQL-specific features such as `JSONB` will not be available.
- Some future queries or features may require additional consideration if they depend on PostgreSQL-specific functionality.
- A future migration may require changes to the schema or SQL queries.

### Risks

- Future AI or search requirements may benefit from PostgreSQL-specific features that are not currently available in MariaDB.
- If the project becomes heavily dependent on MariaDB-specific behavior, a future migration could become more difficult.
- The current decision may need to be revisited if the data model or application requirements change significantly.

---

## Implementation Notes

- MariaDB will be used as the database system for the current implementation of DAKA.
- The database schema should favor standard SQL features where practical.
- JSON should be used only where flexible, category-specific attributes are actually required.
- Database-specific features should be introduced deliberately and documented when necessary.
- If future requirements make PostgreSQL significantly more appropriate, the database decision should be reassessed through a new ADR.

---

## References

- MariaDB documentation - JSON data types and functions
- PostgreSQL documentation - JSON and JSONB data types

---

## Related ADRs

- None