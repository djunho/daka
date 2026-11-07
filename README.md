*This project has been created as part of the 42 curriculum by djunho, bfiochi-, cmoura-p, alde-alm.*

# Daka (Toma-lá-dá-cá)

## Description

**Daka** is a web marketplace for exchanging second-hand items without money. Users can publish items they no longer need with photos and supporting PDF documents, state what they would like in return, browse and filter the catalog, save favorite listings, and manage friendships. An interested user can open a private negotiation with the listing owner to chat in real time, propose or review offers, agree on a swap, and record its completion.

The interface is in European Portuguese. Browsing the catalog is public; publishing, saving favorites, managing friendships, opening attached documents, and negotiating require an account.

## Instructions

### Requirements

- Docker Engine or Docker Desktop with the Docker Compose v2 plugin (`docker compose version`).
- GNU Make and Bash, with Docker running and accessible to the current user.
- Optional `htpasswd` (if unavailable, the secrets script runs it via an `httpd:2.4-alpine` container).
- The latest stable version of Google Chrome. The first build requires network access to pull container images and install dependencies; Node.js and Python run inside the containers.

### Run locally

1. Clone the repository, enter its root, and create the local environment file:

   ```sh
   git clone https://github.com/djunho/daka.git
   cd daka
   cp .env.example srcs/.env
   ```

2. Edit `srcs/.env`. Set your MariaDB application, root, and exporter passwords, Prometheus and Alertmanager Basic Auth credentials, and Grafana admin credentials. Keep the default service hostnames and port values from the template for local execution, and keep this file private.
3. From the repository root, run `make`. It generates the local service secrets and builds and starts the Docker Compose stack.
4. Run `make status` to check service health, then open [Daka on localhost](https://localhost:8443). Because the local stack uses a self-signed TLS certificate, accept the browser certificate warning on first visit. Create an account with email and password to test publishing, favorites, friends, and negotiations.

The default HTTPS port is `8443`.

| Service | Local URL |
| --- | --- |
| Daka | [Application](https://localhost:8443/) |
| Design System | [Live style guide](https://localhost:8443/design-system) |
| API | [OpenAPI documentation](https://localhost:8443/api/docs) |
| Grafana | [Dashboards](https://localhost:8443/grafana/) with the configured Grafana admin credentials |
| Prometheus | [Metrics and alerts](https://localhost:8443/prometheus/) with the configured HTTP Basic credentials |
| Alertmanager | [Active alerts](https://localhost:8443/alertmanager/) with the configured HTTP Basic credentials |

For Google sign-in, create a Google OAuth web client, configure the consent screen and test users, and register the callback URL. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_STATE_SECRET`, and `FRONTEND_URL` in `srcs/.env`, then run `make` again. See the [Google OAuth setup guide](docs/development/google-authentication.md).

Use `make logs` for troubleshooting, `make stop` to pause the stack, and `make down` to remove containers while retaining named volumes. `make clean`, `make fclean`, and `make re` remove named volumes, including the database and uploaded files. See the [backup and restore guide](docs/development/database-backup.md) before running destructive targets.

### Checks

Run these commands from the repository root with the stack running:

```sh
docker compose -f srcs/docker-compose.yml exec -T frontend npm test
docker compose -f srcs/docker-compose.yml exec -T backend python -m unittest discover -s tests
make validate
```

To include opt-in MariaDB integration tests against a local development database initialized with the project schema and seeds:

```sh
docker compose -f srcs/docker-compose.yml exec -T -e RUN_MARIADB_INTEGRATION=1 backend python -m unittest discover -s tests
```

See the [WebSocket test guide](docs/development/negotiation-websocket.md#tests) for integration test details and the [observability guide](docs/development/observability.md) to inspect metrics, dashboards, and alerts.

## Resources

- [React](https://react.dev/learn), [Vite](https://vite.dev/guide/), and [Tailwind CSS](https://tailwindcss.com/docs/installation) for the frontend.
- [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://docs.sqlalchemy.org/en/20/), and [MariaDB](https://mariadb.com/docs/) for the API and database.
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) and [Google OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server) for real-time chat and OAuth sign-in.
- [Docker Compose](https://docs.docker.com/compose/), [Prometheus](https://prometheus.io/docs/introduction/overview/), and [Grafana](https://grafana.com/docs/grafana/latest/) for deployment and monitoring.
- [Daka documentation](docs/README.md) for development guides, file upload rules, and architecture decisions.

### Use of AI

AI tools were used exclusively to assist with writing automated tests, performing code reviews, drafting project documentation and technical guides, and understanding and investigating bugs and technical problems. All AI-assisted output was reviewed, adapted, and validated by the team against the implementation through automated test suites, manual browser verification, and mandatory peer reviews on pull requests.

## Team Information

| 42 login | Team member | Roles and responsibilities |
| --- | --- | --- |
| `djunho` | Daniel Junho | Technical Lead and developer. Guides architecture and stack choices, implements shared infrastructure and features, and reviews technical changes. |
| `bfiochi-` | Beatriz Fiochi Soares da Silva | Developer. Builds and tests user-facing workflows, design system components, and supporting API endpoints. |
| `cmoura-p` | Cláudia Moura Pickett | Project Manager / Scrum Master and developer. Coordinates work and tracks blockers while developing listings, trade logic, and chat infrastructure. |
| `alde-alm` | Alex Neves | Product Owner and developer. Prioritizes the backlog, validates features against product needs, and implements account and social features. |

## Project Management

The team used GitHub Issues to break work into tasks and organized related issues by epic in GitHub Projects. Day-to-day coordination, quick questions, and alignment calls were handled over WhatsApp alongside in-person syncs and discussions on GitHub issue and pull-request threads. Feature and fix branches were reviewed through GitHub pull requests before merging into `dev`, requiring at least one peer review and prohibiting self-approval. GitHub Actions runs Gitleaks and validates the Compose and observability configuration. Key architectural decisions are recorded as ADRs.

See the [development workflow](docs/development/workflow.md), [branch conventions](docs/development/branches.md), and [architecture decisions](docs/adr/README.md).

## Technical Stack

| Layer | Technology and rationale |
| --- | --- |
| Frontend | React, TypeScript, and React Router provide reusable UI components, client-side routing, and typed API contracts. Vite serves and bundles the frontend, Vitest with Testing Library runs unit and component tests, and Tailwind CSS with Daka's design tokens provides consistent styling. |
| Backend | Python, FastAPI, Pydantic, and Uvicorn provide validated REST endpoints and WebSocket connections. `bcrypt` hashes passwords, `Authlib` handles Google OAuth, `Pillow` normalizes uploaded images to WebP, and `pypdf` validates uploaded PDF documents. |
| Database | MariaDB with SQLAlchemy and PyMySQL. MariaDB was chosen because the barter domain is relational and requires strong referential integrity, `UNIQUE` and `CHECK` constraints, and ACID transactions with row-level locks (`SELECT ... FOR UPDATE`) to safely resolve concurrent trade proposals without race conditions, while remaining lightweight in Docker. |
| Deployment | Docker Compose builds and isolates the services. Nginx terminates HTTPS/TLS, proxies REST and WebSocket traffic, and serves public images from a shared media volume, while private PDF documents stay on a backend-only volume. |
| Observability | Prometheus scrapes service metrics, Grafana visualizes them in provisioned dashboards, and Alertmanager groups and routes firing alerts. Exporters (`node-exporter`, `cAdvisor`, `mysqld-exporter`, `blackbox-exporter`) and FastAPI instrumentation cover host, container, database, endpoint, and API metrics. |

Database-backed sessions allow immediate server-side revocation on sign-out or account deletion: the browser holds an opaque cookie token while MariaDB stores only its SHA-256 hash. Real-time chat uses WebSockets for low-latency message delivery, whereas proposals and trade state transitions use transactional REST endpoints. See the [negotiation ADR](docs/adr/0002-adopt-chat-centric-negotiations.md).

## Database Schema

Most entity tables use an auto-incrementing `INT` primary key linked by foreign keys. MariaDB stores metadata and file paths, while public image files live on the `media` volume and private PDF attachments live on the backend-only `documents` volume.

| Tables | Relationships and key fields |
| --- | --- |
| `users`, `sessions` | One user can have multiple sessions. Users have a unique `VARCHAR(255)` email, optional password hash and Google subject, avatar path, `DATETIME` activity timestamp (`last_seen`), and `DATETIME` soft-deletion timestamp (`deleted_at`). Sessions store a unique SHA-256 token hash as `CHAR(64)` and a `DATETIME` expiry. |
| `friendships`, `favorites` | Friendships link two users with a composite key, the constraint `user_id < friend_id`, and an `ENUM` status. Favorites link users to listings with a composite key `(user_id, listing_id)`. |
| `listings`, `images`, `documents` | Each listing belongs to a user and references a category, condition, and state, with a `VARCHAR(150)` title and `TEXT` description and swap preference (`wish`). Listings can have multiple images (`VARCHAR(150)` path and `BOOLEAN` cover flag) and PDF documents (`VARCHAR(64)` stored filename, `VARCHAR(150)` original name, `INT` byte size, and `SMALLINT` page count). |
| `negotiations`, `proposals` | Each listing and interested-user pair has one unique negotiation. A negotiation contains proposals referencing a state and an optional offered listing. A generated `INT` key (`COALESCE(offered_listing_id, 0)`) and composite `UNIQUE` constraint prevent duplicate offers within a negotiation. |
| `messages` | Each chat message belongs to one negotiation and stores a sender foreign key, `VARCHAR(250)` content, and creation `TIMESTAMP`. |
| Lookup tables | `categories`, `conditions`, `listings_states`, `negotiation_states`, and `proposal_states` store the reference states and taxonomies used by listings and trades. |
| `reports` | Reserved in the schema for reporting users or listings (`VARCHAR(250)` reason); not used by an active moderation workflow. |

See the [entity relationship diagram](srcs/services/mariadb/dakaERD.md), [SQL schema](srcs/services/mariadb/schema.sql), and [database guide](docs/development/database.md).

## Features List

| Feature | What it does | Contributors |
| --- | --- | --- |
| Accounts and sessions | Sign up, sign in with email or Google OAuth, sign out, and soft-delete an account with data anonymization. | Alex, Daniel, Beatriz |
| Profiles and avatars | View public profiles and their active listings, edit profile details and location, and preview, upload, or remove an avatar. | Daniel, Beatriz |
| Friends and presence | Add or remove friends, browse the friends list, and see activity-based online status. | Alex, Beatriz, Daniel |
| Catalog and search | Browse available listings, search by text, filter by category and location, sort results, and paginate results. | Cláudia, Beatriz, Daniel |
| Favorites | Save listings from any card or listing page, and review or remove them on the favorites page. | Cláudia, Beatriz |
| Listing and photo management | Publish, edit, or remove listings. Add photos, select a cover, remove images, and browse a listing's gallery. | Cláudia, Daniel, Beatriz |
| Listing documents | Attach PDF documents to a listing, follow the upload progress, and open them after signing in. | Beatriz |
| Negotiations and offers | Open a negotiation, propose or reopen offers, accept, reject, or withdraw proposals, and complete or cancel a swap. | Cláudia, Beatriz, Daniel |
| Negotiation chat and dock | Exchange real-time messages over WebSockets, load earlier history, recover after reconnects, and access active chats from the floating dock. | Cláudia, Daniel |
| Design system and legal pages | Use shared accessible components, the `/design-system` live style guide, responsive layouts, and Privacy Policy and Terms of Service pages. | Daniel, Beatriz |
| Deployment and monitoring | Launch the stack with a single command, validate configurations, and inspect protected Prometheus, Grafana, and Alertmanager interfaces. | Daniel, Cláudia, Beatriz |

## Modules

Each **Major** module is worth **2 points** and each **Minor** module is worth **1 point**. The implemented modules below reach the **14 mandatory points** required by the subject plus **bonus modules** (5 Major × 2 pts + 5 Minor × 1 pt = **15 points** from standard modules, plus 2 points from the custom Major module of choice). Note that demonstrating Google OAuth requires a configured Google client.

| Module | Type | Points | Justification and implementation | Contributors |
| --- | --- | ---: | --- | --- |
| Frontend and backend frameworks | Major | 2 | Chosen to structure a multi-page SPA and a validated API cleanly. Implemented with React, TypeScript, and React Router on the frontend, and FastAPI with Pydantic on the backend. | Daniel, Beatriz, Cláudia, Alex |
| Real-time features using WebSockets | Major | 2 | Chosen so negotiation participants receive chat messages immediately without polling. Implemented with cookie-authenticated FastAPI WebSockets proxied by Nginx, room broadcasting after DB commit, graceful disconnect cleanup, and history recovery on reconnect. | Cláudia, Daniel |
| Allow users to interact with other users | Major | 2 | Chosen because bartering relies on direct communication and trust between members. Implemented via real-time negotiation chat, public user profiles with active listings, and a mutual friendship system. | Cláudia, Daniel, Alex, Beatriz |
| Standard user management and authentication | Major | 2 | Chosen to provide secure account lifecycle and social identity. Implemented with `bcrypt` password hashing, SHA-256 database sessions, profile editing, WebP avatar uploads with default initials fallback, friendships, and `last_seen` online presence. | Daniel, Beatriz, Alex |
| Monitoring system with Prometheus and Grafana | Major | 2 | Chosen to give visibility into container, host, database, and API health. Implemented with Prometheus scraping FastAPI and four exporters (`node`, `cadvisor`, `mysqld`, `blackbox`), provisioned Grafana dashboards, Alertmanager rules, and authenticated web access. | Daniel |
| Use an ORM for the database | Minor | 1 | Chosen to keep database queries composable and transactional in Python. Implemented with SQLAlchemy mapped models, relationships, and transactional session management. | Daniel, Cláudia, Alex, Beatriz |
| Custom-made design system | Minor | 1 | Chosen to keep visual consistency and WCAG AA contrast without external UI or icon libraries. Implemented with Tailwind theme tokens, Fraunces/Outfit typography, a custom SVG icon set, a [live style guide](docs/design/design-system.md) (`/design-system`), and over 10 reusable React components (including `Avatar`, `Button`, `CategoryChips`, `ChatMessageBubble`, `ConfirmDialog`, `DocumentItem`, `Icon`, `ImagePicker`, `ListingCard`, `LocationAutocomplete`, `LogoMark`, `MessageCard`, `OnlineBadge`, `ProfileField`, and `UploadProgress`). | Daniel, Beatriz |
| Advanced search functionality | Minor | 1 | Chosen so users can quickly narrow down items to swap. Implemented with combined text search, category and location filters, multiple sort orders, and paginated backend queries. | Cláudia, Beatriz, Daniel |
| File upload and management system | Minor | 1 | Chosen so listings can include item photos and supporting PDF documents (manuals, warranties, receipts). Avatars, listing photos, and PDF documents are validated by type and size on the client and server, stored outside the repository, previewed, and removable; uploads show progress and PDFs are served only to signed-in users. | Beatriz, Daniel |
| Remote authentication with OAuth 2.0 | Minor | 1 | Chosen to offer frictionless sign-in alongside email and password. Implemented with Google OAuth 2.0 via `Authlib`, signed state cookies, account linking, and post-login redirect preservation. | Alex, Daniel |
| **Subtotal (Standard Modules)** | | **15** | **5 Major (10 pts) + 5 Minor (5 pts) — 14 mandatory points + 1 bonus point.** | |

### Custom Module of Choice (Bonus — Major, 2 points): Multi-Party Barter Negotiation Lifecycle

- **Why we chose this module:** Unlike a standard e-commerce cart, a barter marketplace has no currency; users negotiate item-for-item swaps where multiple people may compete for the same listing or offer the same item across different conversations.
- **Technical challenges addressed:** Preventing double-reservation and race conditions when concurrent requests accept, withdraw, reopen, or cancel proposals touching the same listings, while keeping chat and offer histories intact.
- **How it adds value and why it deserves Major status (2 points):** Implemented as a transactional state machine across `listings`, `negotiations`, and `proposals` using row-level database locks, a generated uniqueness key for empty or item-backed offers, automatic cancellation of competing negotiations upon trade completion, and full frontend workflow integration. Contributed by Cláudia, Beatriz, and Daniel. See [ADR-0002](docs/adr/0002-adopt-chat-centric-negotiations.md) and [ADR-0003](docs/adr/0003-allow-reopening-withdrawn-proposals.md).

## Individual Contributions

- **Daniel Junho (`djunho`):** Built shared frontend components, the listing publication flow, profile and location autocomplete interfaces, legal pages, OAuth frontend/backend integration, the real-time chat widget and negotiations dock, and the Prometheus/Grafana/Alertmanager observability stack. He resolved chat reconnection races by reloading and deduplicating message history on socket recovery, and hardened observability endpoints with HTTP Basic Auth and internal-only metric routes.
- **Beatriz Fiochi Soares da Silva (`bfiochi-`):** Built the catalog interface (home feed, search, filters, and sorting), the listing pages (detail with gallery, editing, and removal), public profiles, favorites, and the friends and presence UI. She designed the reusable image pipeline for avatars and listing photos, and added PDF documents to listings with upload progress. She developed the negotiation interface and its actions, completed the design system (icon set, logo, `/design-system` page, WCAG AA contrast), and made the layout responsive. She hardened login so every failure gets the same answer, and addressed stale proposal choices by refreshing after conflicts and allowing withdrawn offers to reopen through a dedicated endpoint.
- **Cláudia Moura Pickett (`cmoura-p`):** Implemented listing CRUD and browsing APIs, favorites endpoints, and the negotiation and proposal state-transition engine. She built the Nginx WebSocket proxy configuration, cookie session authorization, connection registry, message persistence, real-time broadcasting, and cursor-based message history, along with transaction and concurrency tests covering races between chat delivery and trade state changes.
- **Alex Neves (`alde-alm`):** Implemented authentication routes, Google OAuth 2.0 authentication and its setup documentation, friendship persistence and REST endpoints, and activity-based online presence tracking (including immediate presence cleanup on sign-out). He prevented duplicate or inverted friendship records by normalizing user ID pairs and enforcing the ordering with a database `CHECK` constraint.
