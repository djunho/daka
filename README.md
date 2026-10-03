*This project has been created as part of the 42 curriculum by djunho, bfiochi-, cmoura-p, alde-alm

# Description

Toma-la dáka! This is under the scope of our 42 transcendence project.

# Instructions

# Resources

Google authentication
The complete Google OAuth setup and testing instructions are documented in [`docs/development/google-authentication.md`](../../../docs/development/google-authentication.md).

Before testing Google authentication:
- Configure the OAuth consent screen and add the test account in Google Cloud Console.
- Create a Web application OAuth client with the exact redirect URI documented in the guide.
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_STATE_SECRET`, and `FRONTEND_URL` in `srcs/.env`.
- Rebuild the backend so it loads the OAuth dependencies and environment variables.

Use the linked guide for the complete login flow, account linking rules, security details, troubleshooting steps, and MariaDB verification queries.

# Team Information

# Project Management

# Technical Stack

# Database Schema

# Features List

# Modules

# Individual Contributions

# Subject requirements

### 1. General & Organizational Requirements
- **Team Size & Participation**: 4–5 members. Every team member must actively participate and contribute to both the mandatory core and modules.
- **Mandatory Team Roles**: Roles must be assigned and documented in the README:
  - **Product Owner (PO)**: Maintains backlog, feature prioritization, validates completed work, stakeholder communication.
  - **Project Manager (PM) / Scrum Master**: Facilitates coordination, organizes meetings, tracks deadlines, resolves blockers.
  - **Technical Lead / Architect**: Defines technical architecture, stack decisions, code quality, critical reviews.
  - **Developers (All Members)**: Feature implementation, testing, code reviews, documentation.
- **Git Practices**: Clear and meaningful commit messages from all team members demonstrating balanced work distribution.
- **AI Policy**: AI tools may be used to boost productivity, but all team members must fully understand and be able to justify any AI-generated code. AI usage must be documented in the README.
- **Peer Evaluation & Live Code Modification**: Each member must be able to explain the project. Evaluators may request a brief live code modification during defense to verify authentic understanding.

### 2. Technical & Architectural Requirements
- **Architecture**: Web application consisting of a distinct Frontend, Backend, and Database.
- **Containerization**: Entire application must be containerized (Docker, Podman, etc.) and launchable via a single command.
- **Browser Compatibility**: Fully compatible with the latest stable version of Google Chrome.
- **Console Cleanliness**: Zero JavaScript errors or warnings in the browser console.
- **Security & Network**:
  - All external connections to the backend (browsers, scripts, APIs) must use HTTPS (internal backend-to-backend container traffic can be unencrypted).
  - All forms and inputs must be validated on both the Frontend and Backend.
  - Sensitive credentials/secrets must reside in a local `.env` file (ignored by `.gitignore`), and a `.env.example` template must be provided in the repository.
- **Frontend & Styling**:
  - Clear, responsive, and accessible UI across all devices.
  - Must use a CSS framework or styling solution (Tailwind CSS, Bootstrap, Material-UI, Styled Components, etc.).
- **Database**: Clear schema with well-defined relational/data structures.

### 3. Core Functional Requirements
- **User Management**: Basic secure authentication (sign-up, login) with hashed and salted passwords.
- **Multi-User Concurrency**: Support multiple simultaneous active users without race conditions, data corruption, or performance issues, reflecting real-time updates when applicable.
- **Legal Compliance Pages**: Easily accessible Privacy Policy and Terms of Service pages with project-relevant content (no empty/placeholder text).

### 4. Modules & Evaluation
- **Points Threshold**: Minimum of 14 points required (Major modules = 2 pts, Minor modules = 1 pt).
- **Module Dependencies & Rules**:
  - Gaming extensions (AI Opponent, Tournaments, Game Customization, Spectator Mode, 3+ Players, Game Stats) require a functional base game first.
  - Advanced Chat features require basic chat functionality first.
  - Server-Side Rendering (SSR) cannot be combined with ICP blockchain backend.
- **Validation**: Incomplete or non-functional modules award 0 points during evaluation.

# Checklist

### Team & Project Management
- [X] Team consists of 4 to 5 members
- [ ] All team members actively contribute to both the mandatory part and modules
- [ ] Required team roles assigned and documented:
  - [X] Product Owner (PO) - Alex
  - [X] Project Manager (PM) / Scrum Master - Claudia
  - [X] Technical Lead / Architect - Daniel
  - [X] Developers (all members) - Beatriz, Alex, Claudia e Daniel
- [ ] Git repository shows commits from all team members with proper work distribution
- [ ] Clear and meaningful Git commit messages
- [ ] README.md written in English with all mandatory sections and correct header
- [ ] AI usage documented in README and all team members can explain/defend any AI-assisted code
- [ ] All team members prepared to explain architecture and perform a live code modification during peer evaluation

### Architecture & Technical Requirements
- [ ] Full-stack web application with Frontend, Backend, and Database
- [ ] Entire stack runs with a single deployment command via containerization (e.g., Docker / Docker Compose)
- [ ] Compatible with the latest stable version of Google Chrome
- [ ] Zero JavaScript errors and zero JavaScript warnings in the browser console
- [ ] Credentials and secrets stored in `.env` (ignored by Git in `.gitignore`)
- [ ] `.env.example` template provided in the repository
- [ ] Database schema is clear with well-defined relations
- [ ] All external connections to the backend use HTTPS
- [ ] All forms and user inputs validated on both Frontend and Backend
- [ ] Responsive frontend styled using a CSS framework / styling solution (e.g., Tailwind CSS, Bootstrap, Material-UI)

### Core Features & Mandatory Pages
- [ ] Basic user management system with secure sign-up and login
- [ ] Passwords securely hashed and salted
- [ ] Multi-user support allowing multiple simultaneous active users
- [ ] Concurrent user actions handled properly without race conditions or data corruption
- [ ] Real-time updates reflected across connected clients when applicable
- [ ] Accessible Privacy Policy page with project-relevant content (e.g., in footer)
- [ ] Accessible Terms of Service page with project-relevant content (e.g., in footer)

### Modules (14 Points Minimum)
- [ ] Minimum of 14 points accumulated from chosen Major (2 pts) and Minor (1 pt) modules
- [ ] All claimed modules are fully functional and tested (0 points for incomplete modules)
- [ ] Module dependencies respected (e.g., functional game before game extensions, basic chat before advanced chat, SSR not used with ICP)
- [ ] Module justifications and implementations documented in README.md
