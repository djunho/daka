*This project has been created as part of the 42 curriculum by djunho, bfiochi-, cmoura-p, alde-alm.*

# Daka (Toma-lá-dá-cá)

## Description

**Daka** is a web marketplace for exchanging second-hand items without money. List something you no longer use, say what you would like in return, and browse what other people are offering. An interested user can open a private negotiation with the listing owner. They can chat, compare offers, agree on a swap, and record its completion.

The interface is in European Portuguese. The catalog is public. Publishing, managing friendships, and negotiating require an account.

# Instructions

## Requirements

- Docker Engine or Docker Desktop with the Docker Compose v2 plugin. Check with `docker compose version`.
- GNU Make and Bash. Docker must be running and accessible to your user.
- Optional `htpasswd`. If it is unavailable, the secrets script runs it in an `httpd:2.4-alpine` container.
- Google Chrome for the local interface. The first build needs network access to pull images and install dependencies. Node.js and Python run inside the containers.

## Run locally

1. Clone the repository and enter its root. Create the local configuration.

   ```sh
   git clone git@github.com:djunho/daka.git
   cd daka
   cp .env.example srcs/.env
   ```

2. Edit `srcs/.env`. Set your MariaDB application and root passwords, exporter password, Prometheus credentials, and Grafana admin credentials. Keep the service hostnames and port values from the template for the default local setup. Keep this file private.
3. From the repository root, run `make`. It generates the local service secrets and builds and starts the Docker Compose stack.
4. Run `make status` to check the services, then open [Daka on localhost](https://localhost:8443). The local stack generates a self-signed certificate, so Chrome may show a certificate warning. Create an account with email and password to try publishing and negotiating.

The default HTTPS port is `8443`.

| Service | Local URL |
| --- | --- |
| Daka | [Application](https://localhost:8443/) |
| API | [OpenAPI documentation](https://localhost:8443/api/docs) |
| Grafana | [Dashboards](https://localhost:8443/grafana/) |
| Prometheus | [Metrics and alerts](https://localhost:8443/prometheus/) with the configured HTTP Basic credentials |
| Alertmanager | [Active alerts](https://localhost:8443/alertmanager/) |

For Google sign-in, create a Google OAuth web client, configure the consent screen and test users, and register the exact callback URL. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_STATE_SECRET`, and `FRONTEND_URL` in `srcs/.env`, then run `make` again. See the [Google OAuth setup guide](docs/development/google-authentication.md).

Use `make logs` for troubleshooting, `make stop` to pause the stack, and `make down` to remove its containers while retaining named volumes. `make clean`, `make fclean`, and `make re` remove named volumes, including the database and uploaded media. See the [backup and restore guide](docs/development/database-backup.md) before using them.

## Checks

Run these commands from the repository root with the stack running.

```sh
docker compose -f srcs/docker-compose.yml exec -T frontend npm test
docker compose -f srcs/docker-compose.yml exec -T backend python -m unittest discover -s tests
make validate
```

To include MariaDB integration tests, use a local development database initialized with the project schema and seeds.

```sh
docker compose -f srcs/docker-compose.yml exec -T -e RUN_MARIADB_INTEGRATION=1 backend python -m unittest discover -s tests
```

The [WebSocket test guide](docs/development/negotiation-websocket.md#tests) documents the opt-in MariaDB integration tests. The [observability guide](docs/development/observability.md) shows how to inspect metrics, dashboards, and alerts.

# Resources

- [React](https://react.dev/learn), [Vite](https://vite.dev/guide/), and [Tailwind CSS](https://tailwindcss.com/docs/installation) for the frontend.
- [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://docs.sqlalchemy.org/en/20/), and [MariaDB](https://mariadb.com/docs/) for the API and database.
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) and [Google OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server) for chat and sign-in.
- [Docker Compose](https://docs.docker.com/compose/), [Prometheus](https://prometheus.io/docs/introduction/overview/), and [Grafana](https://grafana.com/docs/grafana/latest/) for deployment and monitoring.
- [Daka documentation](docs/README.md) for development guides and architecture decisions.

## Use of AI

The team used OpenAI Codex, Claude, and Antigravity during development. Codex assisted with reviewing the project against the subject, checking sign-in, catalog search, photo uploads, and chat in the browser, and drafting this README. The documentation was checked against the implementation, Git history, and test results. The commit history also records a GitHub Copilot contribution to handling database integrity errors during account deletion. The team is confirming the specific tasks and verification steps for Claude and Antigravity.

# Team Information

| 42 login | Team member | Roles and responsibilities |
| --- | --- | --- |
| `djunho` | Daniel Junho | Technical Lead and developer. Guides architecture and stack choices, implements shared infrastructure and features, and reviews technical changes. |
| `bfiochi-` | Beatriz Fiochi Soares da Silva | Developer. Builds and tests user-facing workflows and their supporting API changes. |
| `cmoura-p` | Cláudia Moura Pickett | Project Manager / Scrum Master and developer. Coordinates the work and tracks blockers while developing listings, trade logic, and chat infrastructure. |
| `alde-alm` | Alex Neves | Product Owner and developer. Prioritizes the backlog, validates features against product needs, and implements account and social features. |

# Project Management

The team used GitHub Issues to break work into tasks and tracked work by epic in GitHub Projects. Feature and fix branches were reviewed in GitHub pull requests before integration into `dev`. The team's workflow calls for at least one peer review and prohibits self-approval. At the kickoff meeting, the team agreed to group related issues by epic. Issue and pull-request threads were used for task discussion and review. GitHub Actions runs Gitleaks and validates the Compose and observability configuration. Technical decisions about location search, negotiation design, and reopening proposals are recorded in ADRs.

See the [development workflow](docs/development/workflow.md), [branch conventions](docs/development/branches.md), and [architecture decisions](docs/adr/README.md).

# Technical Stack

| Layer | Technology and rationale |
| --- | --- |
| Frontend | React 18 and TypeScript 5 provide reusable UI components and typed API contracts. React Router 6 handles navigation. Vite 5 serves the frontend, and Vitest 3 with Testing Library runs its tests. Tailwind CSS 4 and Daka's design tokens provide shared styling. |
| Backend | Python 3.11, FastAPI 0.115, Pydantic 2, and Uvicorn 0.34 provide validated HTTP endpoints and WebSocket connections. bcrypt hashes passwords, Authlib supports Google OAuth, and Pillow normalizes uploaded images to WebP. |
| Database | MariaDB 11 with SQLAlchemy 2 and PyMySQL. Foreign keys and uniqueness constraints express the relationships between listings, negotiations, and offers. Transactions and row locks protect updates involving multiple records. |
| Deployment | Docker Compose builds and connects the services. Nginx terminates TLS, proxies HTTP and WebSocket traffic, and serves images from a shared media volume. |
| Observability | Prometheus collects service metrics, Grafana visualizes them, and Alertmanager groups and routes alerts. node-exporter, cAdvisor, mysqld-exporter, and blackbox-exporter cover host, container, database, and endpoint metrics. FastAPI instrumentation exposes API metrics. |

Database-backed sessions let the server revoke a login immediately when the user signs out. The browser holds an opaque session token and MariaDB stores its hash. Chat uses WebSockets to deliver new messages promptly to both participants. The API handles offers and other trade actions over REST so it can validate each request and apply state changes in a database transaction. See the [negotiation ADR](docs/adr/0002-adopt-chat-centric-negotiations.md).

# Database Schema

Most entity tables use an auto-incrementing `INT` primary key. Foreign keys link the entities below. MariaDB stores image paths and cover flags, while the image files live on the media volume.

| Tables | Relationships and key fields |
| --- | --- |
| `users`, `sessions` | One user can have multiple sessions. Users have a unique `VARCHAR(255)` email, an optional password hash and Google subject, an avatar path, and a `DATETIME` activity timestamp. Sessions store a unique SHA-256 token hash as `CHAR(64)` and `DATETIME` expiry. |
| `friendships`, `favorites` | Friendships link two users with a composite key, the constraint `user_id < friend_id`, and an `ENUM` status. Favorites link users to listings with a composite key. |
| `listings`, `images` | Each listing belongs to a user and references a category, condition, and state. It has a `VARCHAR(150)` title and `TEXT` description and exchange preference. A listing can have multiple images, each with a path and `BOOLEAN` cover flag. |
| `negotiations`, `proposals` | Each listing and interested-user pair has one negotiation. A negotiation can contain multiple proposals. Each proposal references a state and can reference an offered listing. A unique key prevents duplicate offers within one negotiation, including offers without a listing. |
| `messages` | Each message belongs to one negotiation and has a sender, `VARCHAR(250)` text, and a creation `TIMESTAMP`. |
| Lookup tables | `categories`, `conditions`, `listings_states`, `negotiation_states`, and `proposal_states` supply the values referenced by listings and trades. |
| `reports` | Reserved in the schema for reporting users or listings, with a `VARCHAR(250)` reason. The current application has no reporting or moderation workflow. |

See the [entity relationship diagram](srcs/services/mariadb/dakaERD.md), [SQL schema](srcs/services/mariadb/schema.sql) and [database guide](docs/development/database.md).

# Features List

| Feature | What it does | Contributors |
| --- | --- | --- |
| Accounts and sessions | Sign up, sign in with email or Google, and sign out. Update or delete an account. | Alex, Daniel, Beatriz |
| Profiles and avatars | View public profiles and their listings, edit profile details, and preview, upload, or remove an avatar. | Daniel, Beatriz |
| Friends and presence | Add or remove friends, see the friends list, and check online status. | Alex, Beatriz, Daniel |
| Catalog | Browse available listings, search by text, filter by category and location, sort results, and load more pages. | Cláudia, Beatriz, Daniel |
| Favorites API | Authenticated clients can save, list, and remove favorites through the API. The web interface has no favorites controls yet. | Cláudia |
| Listing and photo management | Publish, edit, or remove listings. Add photos, select a cover, remove images, and browse a listing's gallery. | Cláudia, Daniel, Beatriz |
| Negotiations and offers | Open a negotiation, submit alternative offers, accept, reject, withdraw or reopen proposals, and cancel or complete a trade. | Cláudia, Beatriz, Daniel |
| Negotiation chat | Exchange messages live, load earlier messages, recover the thread after reconnecting, and read closed conversations. | Cláudia, Daniel |
| Negotiations dock | Access active negotiations and open their chats from the floating dock. | Daniel |
| Interface and legal pages | Use shared UI components, responsive layouts, and footer links to the Privacy Policy and Terms of Service. | Daniel, Beatriz |
| Deployment and monitoring | Start the stack with Make, inspect service health, and monitor metrics and alerts. | Daniel, Cláudia, Beatriz |

# Modules

The proposed evaluation scope totals **14 points** under the subject's scoring rules. OAuth requires a configured Google client and a live demonstration.

| Module | Type | Points | Implementation and rationale | Contributors |
| --- | --- | ---: | --- | --- |
| Frontend and backend frameworks | Major | 2 | React organizes the interface into reusable components. FastAPI provides routing and schema validation for the API. | Daniel, Beatriz, Cláudia, Alex |
| Real-time features | Major | 2 | Authenticated WebSockets broadcast committed messages to the negotiation room. Connection cleanup, retry, and history recovery let users continue after a disconnect. | Cláudia, Daniel |
| User interaction | Major | 2 | Private negotiation chat, public profiles, and friendship management let users communicate and find people they know. | Cláudia, Daniel, Alex, Beatriz |
| Standard user management and authentication | Major | 2 | Account holders can edit their profile, upload an avatar or use the default, view profiles, add friends, and see online status. | Daniel, Beatriz, Alex |
| ORM | Minor | 1 | SQLAlchemy maps the MariaDB tables and relations and manages queries and transactions. | Daniel, Cláudia, Alex, Beatriz |
| Custom design system | Minor | 1 | Daka defines its own palette, typography, icons, and shared React components including `Avatar`, `Button`, `CategoryChips`, `ConfirmDialog`, `ImagePicker`, `ListingCard`, `ListingGallery`, `LocationAutocomplete`, `MessageCard`, and `OnlineBadge`. | Daniel, Beatriz |
| Advanced search | Minor | 1 | Catalog filters, sort options, and server-side pagination help users find relevant listings as the catalog grows. | Cláudia, Beatriz, Daniel |
| Remote authentication with OAuth 2.0 | Minor | 1 | Google sign-in offers a second authentication method and returns users to their intended page. | Alex, Daniel |
| Monitoring with Prometheus and Grafana | Major | 2 | Exporters expose metrics, a custom Grafana dashboard brings them together, and alert rules flag service and resource problems. Grafana uses authenticated access. | Daniel |
| **Total** | | **14** | Five Major modules and four Minor modules. | |

The negotiation lifecycle is an additional candidate for a **2-point Major module of choice**, outside the 14-point total above. It solves the marketplace-specific problem of coordinating competing offers for the same items. Transactions, row locks, and state transitions reserve the agreed listings and handle conflicting negotiations while preserving the offer history. This lets users agree on a swap without reserving the same item twice. Cláudia implemented and tested the trade lifecycle, Beatriz developed the negotiation UI and proposal reopening, and Daniel contributed to the chat-centered design. See the [negotiation ADR](docs/adr/0002-adopt-chat-centric-negotiations.md) and [proposal reopening ADR](docs/adr/0003-allow-reopening-withdrawn-proposals.md).

# Individual Contributions

- **Daniel Junho** built shared frontend components, the publication flow, profile and location interfaces, legal pages, OAuth integration, and the observability stack. He built the chat widget and handled reconnection by reloading and deduplicating message history.
- **Beatriz Fiochi Soares da Silva** developed avatar and listing photo management, sorting, responsive layouts, friends UI, session checks, and negotiation actions. She addressed stale proposal choices by refreshing after conflicts and allowing withdrawn offers to reopen through a dedicated endpoint.
- **Cláudia Moura Pickett** implemented listing operations, browsing, favorites, and the trade API and lifecycle. She implemented the Nginx WebSocket proxy, session authorization, connection management, message persistence, broadcast, and history. Transaction and concurrency tests exercise races between chat messages, offer acceptance, and changes to listing or negotiation state.
- **Alex Neves** implemented Google authentication and its setup guide, friendship persistence and API endpoints, and activity-based online status. He addressed duplicate friendship pairs by normalizing their order and enforcing that ordering in the schema.
