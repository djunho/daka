# Daka kickoff meeting

**Date:** To be confirmed

**Participants:**

- Beatriz
- Cláudia
- Daniel
- Alex

---

# Agenda

Topics planned for discussion:

- Assignment of responsibilities per team member
- Organization of work by epic in GitHub Projects
- Establishment of rules for branches and commits
- Definition of the structure for ADRs and GitHub Wiki
- Establishment of rules for Pull Requests

---

# Discussion

## Topic 1: Assignment of Responsibilities

**Summary:**

The distribution of roles and responsibilities among team members was discussed to ensure that all project areas are covered and that each member has a clear role from the start of development.

**Decision:**

The following responsibilities were assigned:

| Member      | Responsibilities                        |
| ----------- | --------------------------------------- |
| **Beatriz** | Front-end developer                     |
| **Cláudia** | Project Manager, Back-end and database  |
| **Daniel**  | Infrastructure Management, Front-end    |
| **Alex**    | Product Owner and Back-end developer    |

---

## Topic 2: Organization in GitHub Projects

The team agreed to organize the project by epic in GitHub Projects. Each epic groups related GitHub issues around a shared feature or project area. The board tracks the status of individual issues and gives the team a view of progress across epics. Tasks with dependencies can be planned in the order needed to complete the feature.

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
- Organization of related issues into epics in GitHub Projects.
- Naming standards for branches and commits established.
- Creation of ADRs for technical decisions and use of GitHub Wiki for documentation.
- Rules for Pull Requests defined, with mandatory review by another member.
- Creation of initial backlog and development of mockups for interface and flow validation.

---

# Notes

- The team should familiarize themselves with GitHub Projects and the defined structure before the start.
- Any questions regarding the organization should be raised with the Tech Lead or the Project Manager.
- This meeting marks the formal start of the project and the definition of the foundations for development.
- Mockups should be simple and focused on flow validation, with no need to invest in detailed design at this stage.
