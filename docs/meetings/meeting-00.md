# Meeting 1 / SPRINT 00

**Date:** 04-08-2026

**Participants:**

- Bruna
- Cláudia
- Gabriel
- Leandro
- Rodrigo

---

# Agenda

Topics planned for discussion:

- Assignment of responsibilities per team member
- Definition of sprint organization in GitHub Projects
- Establishment of rules for branches and commits
- Definition of the structure for ADRs and GitHub Wiki
- Establishment of rules for Pull Requests
- Discussion on features and mockups

---

# Discussion

## Topic 1: Assignment of Responsibilities

**Summary:**

The distribution of roles and responsibilities among team members was discussed to ensure that all project areas are covered and that each member has a clear role from the start of development.

**Decision:**

The following responsibilities were assigned:

| Member      | Responsibilities                        |
| ----------- | --------------------------------------- |
| **Bruna**   | Project Manager, AI and Front-end       |
| **Cláudia** | Back-end (Database and Docker)          |
| **Gabriel** | Back-end and Infrastructure Management  |
| **Leandro** | Tech Lead and Full-Stack                |
| **Rodrigo** | Product Owner and Front-end             |

---

## Topic 2: Sprint Organization in GitHub Projects

**Summary:**

It was defined that project tracking will be carried out through GitHub Projects, with a sprint-based structure. Rules were discussed to ensure an organized and synchronized workflow among all members.

**Decision:**

The following was established:

- Each sprint will last **one week**.
- If all tasks of a sprint are completed before the deadline, the next sprint **should not be started**. The team must wait until the current sprint ends so that everyone starts the next one together.
- Sprints have sequential dependencies:
  - **Sprint 01** depends on the completion of **Sprint 00**;
  - **Sprint 02** depends on the completion of **Sprint 01**;
  - And so forth.
- All tasks of a sprint must be completed before the start of the following sprint.

---

## Topic 3: Branches and Commits

**Summary:**

The need to standardize branch naming and commit message formatting was discussed to keep the repository history clear and organized.

**Decision:**

The following structure was defined:

**Branches:**
- New features: `FEAT/feature-name`
- Fixes: `FIX/fix-name`

**Commits:**
- Features: `FEAT/feature-name: commit message`
- Fixes: `FIX/fix-name: commit message`
- Documentation: `DOCS: commit message`

---

## Topic 4: Architecture Decision Records (ADR) and GitHub Wiki

**Summary:**

The importance of documenting technical decisions and maintaining accessible documentation for quick reference, both for the current team and future members, was discussed.

**Decision:**

- **ADR (Architecture Decision Record):** Document for recording technical decisions made during development. Each ADR should include, whenever applicable:
  - Decision context;
  - Motivation;
  - Chosen solution;
  - Consequences and impacts of the decision.

- **GitHub Wiki:** Should contain more accessible documentation oriented toward quick consultation. Each feature or component should describe:
  - What it is;
  - Its purpose;
  - Technologies used;
  - How these technologies work;
  - Useful information for future team members.

---

## Topic 5: Pull Requests (PRs)

**Summary:**

Rules for submitting and reviewing Pull Requests were discussed to ensure code quality and knowledge sharing within the team.

**Decision:**

The following was established:

- Self-approval of Pull Requests is **not** allowed.
- Every Pull Request must be reviewed and approved by at least one other team member.
- Whenever possible, the review should be performed by a member whose area of expertise is closest to the changes made.
- In urgent situations or when it is not possible to follow the previous rule, any team member may perform the review and approval.

---

# Decisions Made

- Assignment of responsibilities defined as per the table above.
- Organization of sprints in GitHub Projects with weekly duration and sequential dependencies.
- Naming standards for branches and commits established.
- Creation of ADRs for technical decisions and use of GitHub Wiki for documentation.
- Rules for Pull Requests defined, with mandatory review by another member.
- Creation of initial backlog and development of mockups for interface and flow validation.

---

# Action Items

| Person | Task | Deadline |
|---|---|---|
| Everyone | Create repository on GitHub and configure GitHub Projects with sprints | End of Sprint 00 |
| Everyone | Define and document the technology stack on the Wiki | End of Sprint 00 |
| Rodrigo | Create a template for ADRs and share with the team | End of Sprint 00 |
| Bruna | Create the initial product backlog and define priorities | End of Sprint 00 |
| Bruna | Configure GitHub Projects with defined columns and rules | End of Sprint 00 |
| Rodrigo | Coordinate the creation of low-fidelity mockups | End of Sprint 00 |
| Rodrigo | Collaborate with the team for mockup and requirements validation | End of Sprint 00 |
| Everyone | Create initial branches following the defined pattern | End of Sprint 00 |

---

# Notes

- The team should familiarize themselves with GitHub Projects and the defined structure before the start of Sprint 01.
- Any questions regarding the organization should be raised with the Tech Lead (Leandro) or the Project Manager (Bruna).
- This meeting marks the formal start of the project and the definition of the foundations for development.
- Mockups should be simple and focused on flow validation, with no need to invest in detailed design at this stage.