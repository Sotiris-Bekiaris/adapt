> **Unedited historical design brainstorm, preserved for provenance.** This is the raw origin transcript
> that adapt grew out of — it is not documentation and describes nothing that is necessarily still true.
> The durable design record is [superpowers/specs/2026-05-25-adapt-design.md](./superpowers/specs/2026-05-25-adapt-design.md).

I have this idea of a continuous development agent that would maybe the continuous development is not the correct term about it because it might be confused with CI/CD. What I'm meaning is a new term about coding agents working with each other to have a cycle of development that would be autonomous and self-improving. So right now, for example, I have a project and I have a JIRA for this project and I'm using OpenCode as an agent or any other coding agent. It is not, it doesn't have to be OpenCode specific, that OpenCode will use an MCP, specifically the Chrome MCP. So actually I'm rushing it and I'm not describing it properly. There will be many agents communicating with each other. What I'm thinking right now is that one agent will not have access to the source code in the repository, but it will know. that the actual application is running on localhost, for example, and that agent can use the Chrome MCP in order to browse the whole application, and its role will be to go through every page, every button, every input, every dialog, to explore the whole application end-to-end, not end-to-end like back-end front-end, but the whole application as a UI and as a user experience. And by doing that, to create scenarios for a user, simple one-line scenarios or two-line scenarios that would describe what an actual user would do and just write those scenarios down in a markdown file. So for example, I don't want to be specific with examples, but the point is to the agent to be able to see the website, the application, running on localhost using Chrome MCP, and then create those scenarios. Then another agent will read those scenarios and will not have actually no, no, no, no, no, no, no. Let me think about it. I feel, let's discuss this this and let's brainstorm about it. I feel like the scenarios should not be the agent that does not have access to the source code. Maybe this agent can have access to the source code in order to actually be easier to create those scenarios, but without giving any hints or mentioning any of the code or the actual endpoints or whatever, but be user-specific scenarios. So yeah, scratch the what I said about this agent not having access. We want actually this agent to have access to the source code and create the scenarios, and also use Chrome DevTools, MCP, to have a better understanding of the UI and the user experience. So this agent will write the mic down, then another agent will read these scenarios and without having access to the source code, it will try to use the Chrome MCP DevTools and execute those scenarios. And if those scenarios are fulfilled successfully, then we can note scratch them and continue to the next scenario. If a scenario is not successfully fulfilled, then we can, for example, create a Jira issue. Not for example, it will create a Jira issue if the scenario is not fulfilled properly, or if we encounter any bugs or any unwanted behavior in the process of following this scenario. The agent that doesn't have access to the source code will create a Jira issue about it using the Jira MCP. So and scratch every scenario that it works as expected and completes and fulfills the scenario's goal. So then we will have another agent that it will be getting triggered by a webhook from Jira that would start implementing this Jira issue that was created by the other agent. So this agent will obviously have access to the repo and to the source code, both front-end and back-end. So it will start solving this and also have access to Chrome MCP DevTools and also have access to the scenario. The scenario, I feel like it must be mentioned as well in the Jira issue, so we can have the whole context. And if this succeeds, then updates the Jira to in review. And this will trigger a webhook to the other agent that is responsible for the scenario and creating the Jira issues. It will run as well the Chrome DevTools MCP, and if it sees that it can actually use, fulfill the scenario's goal, then updates the Jira to done. And we are okay. Meanwhile, obviously, the agent continues until there are always scenarios. And the other agent watches the file with the scenarios and creates new scenarios. So, what do you think about this? Maybe let's brainstorm about it and help me structure my thoughts and maybe fix any logical loops I'm having or anything that sounds impractical or could be approached in a better way. I want your input and let's have this system design and this whole flow about this initiative.

Your core idea is sound. I would not call it “continuous development” because that collides with CI/CD and sounds too broad. The more precise concept is something like:

**Scenario Driven Agentic Development**

or:

**Autonomous Product Validation Loop**

or, more operationally:

**Agentic QA Repair Loop**

The essence is not “agents continuously coding”. The essence is:

> Agents continuously discover user scenarios, validate them against the running product, convert failures into tracked work, implement fixes, and reverify the same scenario until the product behavior matches the intended user outcome.

That is a strong concept. The main challenge is avoiding circular reasoning, noisy Jira spam, flaky validations, and agents reinforcing each other’s mistakes.

## The core loop

I would model the system as five cooperating agents, not three.

```text
Product Understanding Agent
        ↓
Scenario Backlog
        ↓
Black Box Scenario Runner
        ↓
Failure Triage / Jira Agent
        ↓
Implementation Agent
        ↓
Independent Verification Agent
        ↓
Scenario Backlog / Jira Done
```

The key architectural point is that not all agents should have the same knowledge or permissions.

## Agent roles

### 1. Product Understanding Agent

This agent has access to:

```text
source code
running localhost app
Chrome DevTools MCP
existing docs
existing Jira issues
maybe README, tests, routes, database schema
```

Its job is to understand what the product appears to do and produce user centered scenarios.

It may use the source code to discover routes, feature flags, hidden flows, roles, permissions, forms, validation rules, and product boundaries. But the scenarios it writes must be black box and user oriented.

Bad scenario:

```text
Call POST /api/projects with payload X and expect status 201.
```

Good scenario:

```text
As a project manager, create a new project from the Projects page and verify that the new project appears in the project list.
```

This agent is allowed to know implementation details, but it should not leak them into the scenario unless they are visible to a user.

This is useful because pure UI crawling will miss flows that require specific setup, permissions, or hidden navigation paths. Source awareness helps it create better scenarios.

### 2. Scenario Backlog

This should not be just a simple markdown checklist. Markdown is fine as the human readable surface, but the scenarios need stable IDs and metadata.

A scenario should look more like this:

```markdown
## SCN-001: Create a new project

Persona: Project manager

Preconditions:

- User is logged in as a project manager.
- The workspace has permission to create projects.

Steps:

1. Open the Projects page.
2. Select the option to create a new project.
3. Enter a valid project name.
4. Submit the form.

Expected outcome:

- The project is created successfully.
- The new project appears in the project list.
- No validation or server error is shown.

Failure signals:

- The submit button does nothing.
- A visible error appears.
- The project does not appear after creation.
- The browser console shows an uncaught error.

Tags:

- projects
- create-flow
- smoke
- regression-candidate

Status:

- ready
```

Important: do not scratch working scenarios permanently.

A passed scenario is valuable. It becomes a regression scenario. Instead of deleting or scratching it, store execution results separately:

```text
scenario remains in backlog
run result says passed on commit abc123
```

Otherwise the system will lose coverage over time.

Better structure:

```text
/scenarios
  projects.create.md
  auth.login.md
  billing.upgrade.md

/scenario-runs
  2026-05-25T10-15-00Z.json
  2026-05-25T11-20-00Z.json
```

The scenario file describes intent. The run log describes what happened.

### 3. Black Box Scenario Runner

This is the agent that should not have source code access.

It has access to:

```text
localhost app
Chrome DevTools MCP
test credentials
scenario backlog
maybe seeded data instructions
```

It should behave like a user.

Its job is to execute scenarios and classify the outcome:

```text
passed
failed
blocked
flaky
invalid scenario
needs clarification
```

This distinction matters a lot.

Not every unsuccessful run should create a Jira bug.

Examples:

```text
failed: The app crashes when saving a valid form.
blocked: Cannot log in because no credentials were provided.
flaky: Same scenario passed once and failed once.
invalid scenario: Scenario references a feature that no longer exists by product decision.
```

Only real product failures should become Jira issues.

The runner should capture evidence:

```text
browser screenshots
DOM snapshot
console errors
network failures
URL
scenario ID
step where failure occurred
actual behavior
expected behavior
reproduction steps
```

This evidence becomes the payload for Jira.

### 4. Failure Triage / Jira Agent

I would not let the scenario runner directly create Jira issues without a triage layer.

Otherwise you will get duplicate, low quality, noisy issues.

The triage agent should:

```text
deduplicate failures
group related failures
decide whether this is a bug, missing test data, flaky behavior, or invalid scenario
create Jira only when there is a real actionable issue
attach evidence
link the scenario ID
link the run ID
```

Deduplication is critical.

A reasonable dedupe key could be:

```text
scenario_id
page URL or route
failure step
visible error text
console error signature
network error signature
```

If an issue already exists, the agent should comment on the existing Jira issue rather than creating a new one.

The Jira issue should include:

```text
Title:
[SCN-001] Creating a project fails after submitting valid project details

Scenario:
SCN-001: Create a new project

Expected:
The project is created and appears in the project list.

Actual:
After submitting the form, the page remains unchanged and a console error appears.

Reproduction:
1. Log in as project manager.
2. Open Projects.
3. Select Create Project.
4. Enter valid project name.
5. Submit.

Evidence:
- Screenshot
- Console error
- Network request summary
- Browser URL
- Run ID
- Timestamp
- App commit/version

Classification:
bug

Severity:
medium/high depending on scenario priority
```

### 5. Implementation Agent

This agent has access to:

```text
repo
source code
tests
terminal
Chrome DevTools MCP
Jira MCP
scenario file
failure evidence
```

Its job is not just “fix the bug”. It should produce a complete change:

```text
understand failure
write or update automated tests where possible
implement fix
run relevant test suite
manually verify with Chrome MCP
open PR or commit change
update Jira to In Review
```

The implementation agent should not close the issue itself.

It can move Jira to:

```text
In Review
Ready for Verification
```

But not Done.

That protects the loop from self approval.

### 6. Independent Verification Agent

This agent should ideally be separate from the implementation agent.

It has access to:

```text
localhost app with the fix applied
Chrome DevTools MCP
scenario
Jira issue
failure evidence
maybe PR build URL
```

It may or may not have source access. I would start with no source access for this agent. Its value comes from black box verification.

It reruns the exact failing scenario, plus nearby regression scenarios if available.

Outcomes:

```text
verified: move Jira to Done
still failing: reopen or move back to In Progress
partially fixed: comment with evidence
scenario obsolete: mark Needs Product Review
flaky: mark Flaky and require repeated runs
```

This avoids the most dangerous loop:

```text
agent creates issue
same agent fixes issue
same agent says it is fixed
Jira closes
bug remains
```

## The important correction to your original flow

You said:

> If those scenarios are fulfilled successfully, then we can scratch them and continue to the next scenario.

I would not scratch them.

A successful scenario is a regression asset. It should remain in the backlog and be scheduled according to priority.

Better:

```text
new scenario
→ ready
→ executed
→ passed
→ regression pool
→ periodically rerun
```

The system should distinguish between:

```text
discovery scenarios
smoke scenarios
regression scenarios
critical path scenarios
exploratory scenarios
```

Critical scenarios should run often. Deep exploratory scenarios can run less often.

## The main logical loops to avoid

### 1. Source aware scenario generation can encode current bugs as expected behavior

If the scenario generation agent reads the code, it may accidentally infer that broken behavior is intended.

Example:

```text
The code disables the Save button incorrectly.
The agent sees that Save is disabled under condition X.
It writes a scenario expecting the Save button to be disabled.
```

Mitigation:

The Product Understanding Agent can use source code for discovery, but expected outcomes should be grounded in user intent, UI labels, product docs, existing Jira epics, acceptance criteria, and common UX expectations.

A scenario should answer:

```text
What is the user trying to accomplish?
What visible outcome proves success?
```

not:

```text
What does the current implementation do?
```

### 2. UI exploration can generate too many trivial scenarios

A crawler agent may produce noisy scenarios like:

```text
Click the Settings button.
Open the dropdown.
Close the dropdown.
```

Those are not useless, but they are low value unless tied to a user goal.

Mitigation:

Require every scenario to have:

```text
persona
goal
business object
success condition
priority
```

So the agent writes:

```text
As an admin, update the workspace name and verify that the new name is shown in workspace settings.
```

not:

```text
Click the workspace name input.
```

### 3. Jira issue explosion

A single root cause can break 20 scenarios.

Mitigation:

The triage layer should group failures. If login is broken, every authenticated scenario will fail. That should create one high priority Jira issue, not 50.

Failure classification should include:

```text
root cause suspected
downstream failures blocked by existing issue
```

### 4. Infinite fix loops

A fix can fail verification, go back to implementation, fail again, and loop forever.

Mitigation:

Set attempt limits.

Example:

```text
after 2 failed fix attempts: require human review
after 3 flaky runs: classify flaky and stop automatic closure
after repeated scenario ambiguity: require product clarification
```

### 5. Scenario drift

The product changes, but old scenarios remain. Some old scenarios become invalid.

Mitigation:

Add scenario lifecycle states:

```text
draft
ready
active
regression
deprecated
needs product review
```

Deprecated scenarios should not be deleted immediately. They should retain history.

### 6. Agent overreach

An implementation agent might change product behavior to satisfy the scenario while breaking real intent.

Mitigation:

For important flows, link scenarios to product requirements, Jira epics, or acceptance criteria. For lower confidence scenarios, use the label:

```text
candidate-scenario
```

A candidate scenario should not automatically trigger code changes unless promoted.

## Recommended state machine

For scenarios:

```text
draft
→ ready
→ running
→ passed
→ regression

ready
→ running
→ failed
→ jira-created
→ awaiting-fix
→ ready-for-verification
→ verified
→ regression

ready
→ running
→ blocked
→ needs-environment-fix

ready
→ running
→ invalid
→ needs-product-review
```

For Jira:

```text
Open
→ Triaged
→ In Progress
→ In Review
→ Ready for Verification
→ Done

or

Ready for Verification
→ Reopened
→ In Progress
```

For execution runs:

```text
queued
→ running
→ passed
→ archived

queued
→ running
→ failed
→ triaged

queued
→ running
→ inconclusive
→ retry
```

## Better artifact design

I would use three durable artifacts.

### 1. Scenario spec

Human readable. Version controlled.

```text
/scenarios/*.md
```

Contains the user goal, preconditions, steps, and expected outcome.

### 2. Scenario registry

Machine readable.

```text
/scenarios/index.json
```

Contains IDs, status, priority, tags, ownership, and links.

Example:

```json
{
  "id": "SCN-001",
  "title": "Create a new project",
  "status": "active",
  "priority": "high",
  "tags": ["projects", "create-flow", "smoke"],
  "source": "agent-discovered",
  "jiraLinks": [],
  "lastResult": "passed",
  "lastRunId": "RUN-20260525-001"
}
```

### 3. Run ledger

Append only execution history.

```text
/runs/*.json
```

This gives you auditability.

The mistake would be to use the markdown file itself as both scenario definition and execution state. That becomes messy quickly.

## Chrome MCP versus generated Playwright tests

Chrome MCP is excellent for exploration, diagnosis, and flexible human like interaction.

But for stable regression, you may eventually want the agents to produce Playwright tests from validated scenarios.

I would use both:

```text
Chrome MCP:
exploration
first execution
bug reproduction
visual inspection
debugging

Playwright:
repeatable regression
CI integration
fast deterministic checks
evidence capture
```

The system can evolve like this:

```text
Scenario discovered
→ executed successfully several times with Chrome MCP
→ promoted to regression
→ converted into Playwright test
→ run in CI
```

This gives you a bridge from autonomous exploration to deterministic engineering practice.

## What “self improving” should mean

Be careful with “self improving”. It should not mean agents rewrite their own instructions freely.

A safer definition:

```text
The system improves its scenario library, failure classifiers, deduplication rules, test coverage, and implementation heuristics based on observed failures and successful fixes.
```

Examples of safe self improvement:

```text
When a bug is fixed, add a regression scenario.
When duplicate Jira issues are detected, improve dedupe signatures.
When a scenario is flaky, add stronger preconditions or test data setup.
When a page is discovered, add it to the exploration map.
When a scenario repeatedly fails due to missing data, create a seed data requirement.
```

Risky self improvement:

```text
agents silently changing their own prompts
agents lowering pass criteria to get green results
agents closing their own bugs
agents deleting scenarios that fail too often
```

The system should improve artifacts, not silently relax standards.

## A cleaner end to end flow

Here is the version I would implement.

```text
1. Product Understanding Agent scans app and repo.
2. It creates or updates user centered scenarios.
3. Scenario Triage Agent reviews scenario quality and marks them ready.
4. Black Box Runner executes ready scenarios against localhost or preview environment.
5. Runner records evidence and result.
6. Failure Triage Agent classifies failures.
7. Real failures create or update Jira issues.
8. Jira webhook triggers Implementation Agent.
9. Implementation Agent creates a fix branch and updates Jira to In Review or Ready for Verification.
10. Independent Verification Agent reruns the exact failed scenario.
11. If verified, Jira moves to Done and scenario becomes regression coverage.
12. If not verified, Jira is reopened with fresh evidence.
```

This is the important control structure:

```text
Generator can know the code.
Runner should not know the code.
Fixer must know the code.
Verifier should be independent from fixer.
Jira closer should not be the same agent that implemented the fix.
```

## Permissions model

I would explicitly restrict tools per agent.

| Agent                       |     Source Code |    Chrome MCP |      Jira MCP | Write Code |                   Close Jira |
| --------------------------- | --------------: | ------------: | ------------: | ---------: | ---------------------------: |
| Product Understanding Agent |             yes |           yes |          read |         no |                           no |
| Scenario Runner             |              no |           yes | no or limited |         no |                           no |
| Failure Triage Agent        | no or read only | evidence only |           yes |         no |                           no |
| Implementation Agent        |             yes |           yes |   update only |        yes |                           no |
| Verification Agent          |   preferably no |           yes | update status |         no | yes, only after verification |
| Orchestrator                |   metadata only |            no |       limited |         no |                           no |

This matters because agentic systems fail badly when every agent has every permission.

## The orchestrator is the missing piece

You probably need an orchestrator, not just agents watching files and Jira.

The orchestrator owns:

```text
which scenarios are runnable
which agent gets triggered
which environment is under test
which commit is being tested
which Jira issue maps to which scenario
how retries work
how duplicate failures are handled
when humans must intervene
```

Without this, file watching plus Jira webhooks will become hard to reason about.

The orchestrator can be simple at first:

```text
a small service
a queue
a SQLite/Postgres table
a run ledger
webhook handlers
agent invocation commands
```

You do not need a complex platform initially.

## Initial MVP

I would not start with all agents fully autonomous.

Start with this:

```text
1. Scenario Generator creates 20 to 50 scenarios.
2. Human reviews and approves them once.
3. Scenario Runner executes them with Chrome MCP.
4. Failures create high quality Jira issues.
5. Implementation Agent fixes one issue at a time.
6. Verification Agent reruns the failed scenario.
```

Only after that works should you add:

```text
automatic scenario generation on every change
automatic deduplication
automatic Playwright generation
automatic prioritization
automatic regression promotion
multi agent parallel execution
```

The MVP success metric should be:

```text
Can the system discover real user visible bugs and produce Jira issues good enough for an engineer or coding agent to fix without additional clarification?
```

That is the first milestone.

## Practical design recommendations

Use scenario IDs everywhere.

```text
SCN-001
RUN-20260525-001
JIRA-123
commit SHA
branch name
PR link
```

Every Jira issue should contain the scenario ID. Every scenario should contain linked Jira issues. Every run should contain the app version or commit.

Do not rely only on natural language memory between agents.

Agents should communicate through durable artifacts:

```text
scenario files
run logs
Jira issues
PR comments
verification reports
```

Keep agent messages disposable. Keep artifacts authoritative.

## My recommended terminology

I would frame the initiative as:

**Scenario Driven Agentic Development**

Definition:

> A multi agent software development loop where agents continuously discover user level scenarios, validate them against the running product, convert verified failures into tracked work, implement fixes, and independently revalidate the original scenario before closure.

For a shorter product name:

```text
Autonomous Product Validation Loop
```

For an engineering architecture name:

```text
Agentic QA Repair Loop
```

For a more ambitious research style name:

```text
Self Improving Scenario Driven Development
```

My preference is **Scenario Driven Agentic Development** because it centers the scenario as the unit of truth. That prevents the system from becoming “random agents clicking around and filing bugs”.

## The most important design principle

The scenario is the contract.

Not the code.
Not the Jira issue.
Not the agent’s memory.
Not the current UI behavior.

The contract is:

```text
A real user has a goal.
The app should allow that user to accomplish it.
The system can prove whether that goal is currently achievable.
```

Everything else should orbit around that.

i agree with everything. just one clarification, when i mentioned self improvement i didnt mean the agents to self improve. i was thinking this whole process of self improving the repo with no human intervation. the agent remain the same. they just keep improving the product.

so now based on everything we said provide in plain text a complete prompt for codex / claude code so i can start implementing my idea

You are working inside an existing software repository.

Your task is to implement the first MVP of a system called Scenario Driven Agentic Development.

Important clarification: “self improving” does not mean agents modify themselves, rewrite their own prompts, or change their own behavior. It means the product repository improves over time through an autonomous loop: agents discover user level scenarios, validate the running application, create Jira issues for real failures, implement fixes, and independently verify the original scenario before closure. The agents remain static. The repository, tests, scenarios, and product quality improve.

Goal:

Implement a minimal but extensible framework in this repository for an autonomous product validation and repair loop.

The system should support this flow:

1. A source aware Scenario Generator Agent inspects the repository and, when possible, the running app through Chrome DevTools MCP.
2. It creates user centered scenario files.
3. A black box Scenario Runner Agent reads those scenarios and validates them against the running application using Chrome DevTools MCP, without relying on source code knowledge.
4. The runner records structured run results.
5. A Failure Triage Agent analyzes failed runs, deduplicates them, and creates or updates Jira issues through Jira MCP.
6. A Jira webhook or polling mechanism can trigger an Implementation Agent for an issue.
7. The Implementation Agent fixes the bug in the repository and moves the Jira issue to a review or verification state.
8. An independent Verification Agent reruns the original scenario.
9. If the scenario passes, the issue can be marked done and the scenario becomes regression coverage.
10. If the scenario still fails, the issue is reopened or returned to in progress with fresh evidence.

Do not build a large platform. Build the smallest useful framework that establishes the architecture, artifacts, commands, state model, and extension points.

Core design principle:

The scenario is the contract.

A scenario describes a real user goal, the preconditions, the user level steps, and the visible expected outcome. It must not depend on implementation details, API endpoints, database internals, class names, or source code references.

Source code can be used by the Scenario Generator Agent to discover product functionality, but generated scenarios must remain user centered and black box executable.

Terminology:

Use the name “Scenario Driven Agentic Development” in documentation.

Use this short definition:

Scenario Driven Agentic Development is a multi agent software development loop where agents continuously discover user level scenarios, validate them against the running product, convert verified failures into tracked work, implement fixes, and independently revalidate the original scenario before closure.

Repository changes to make:

1. Add a top level directory for the system.

Preferred directory name:

.agentic-development

If this conflicts with existing conventions, choose the nearest appropriate name and document the decision.

2. Inside that directory, create this structure or a close equivalent:

.agentic-development/
README.md
config.example.json
scenarios/
README.md
scenario-runs/
README.md
agent-prompts/
scenario-generator.md
scenario-runner.md
failure-triage.md
implementation-agent.md
verification-agent.md
schemas/
scenario.schema.json
scenario-run.schema.json
jira-issue.schema.json
scripts/
generate-scenarios
run-scenarios
triage-failures
verify-issue
orchestrate

Use the scripting language and package conventions already present in the repository. If the repo is Node based, prefer TypeScript or JavaScript. If it is Python based, prefer Python. If the repo has no clear scripting convention, use Node with plain JavaScript or Python, whichever is simpler and already available.

3. Implement a scenario file format.

Use markdown for human readability, with YAML frontmatter for machine readable metadata.

Example format:

---

id: SCN-001
title: Create a new project
status: active
priority: high
persona: Project manager
tags:

- projects
- create-flow
- smoke
  source: agent-discovered
  lastResult: unknown
  linkedIssues: []

---

# Scenario

As a project manager, create a new project from the Projects page and verify that the new project appears in the project list.

## Preconditions

- The user is logged in as a project manager.
- The workspace allows project creation.

## Steps

1. Open the Projects page.
2. Choose the option to create a new project.
3. Enter a valid project name.
4. Submit the form.

## Expected outcome

- The project is created successfully.
- The new project appears in the project list.
- No validation error, server error, or uncaught browser error is shown.

## Failure signals

- The submit button does nothing.
- A visible error appears.
- The project does not appear after creation.
- The browser console shows an uncaught error.

4. Implement a scenario run result format.

Scenario run results must be append only. Do not mutate scenario files to store detailed execution history.

Each run result should contain at least:

runId
scenarioId
scenarioTitle
status: passed, failed, blocked, flaky, invalid, inconclusive
startedAt
finishedAt
appBaseUrl
appVersion or commitSha if available
environment
stepsExecuted
failureStep if applicable
expectedOutcome
actualOutcome
consoleErrors
networkErrors
screenshots if available
artifacts if available
linkedJiraIssue if applicable
runnerNotes

Store run results as JSON files in:

.agentic-development/scenario-runs/

5. Implement JSON schemas.

Add schemas for:

scenario metadata
scenario run result
Jira issue payload

The schemas do not need to be perfect, but they should enforce the core fields and valid status values.

6. Implement agent prompt files.

Create prompt files for each agent.

Each prompt should be complete enough to be used by Codex, Claude Code, or another coding agent.

The prompts should define each agent’s role, allowed inputs, forbidden behavior, expected outputs, and quality bar.

Agent 1: Scenario Generator Agent

Responsibilities:

- Inspect the repo to understand product capabilities.
- Use Chrome DevTools MCP if available to explore the running app.
- Create or update user centered scenarios.
- Use source code only for discovery.
- Do not leak implementation details into scenarios.
- Do not create API level scenarios unless the product is itself an API product.
- Prefer scenarios with clear user goals and visible success criteria.
- Assign IDs, priorities, tags, and statuses.
- Avoid generating trivial click only scenarios unless they represent a meaningful user goal.

Agent 2: Scenario Runner Agent

Responsibilities:

- Read active scenario files.
- Execute each scenario against the running app using Chrome DevTools MCP.
- Behave like a user.
- Do not inspect source code.
- Record structured run results.
- Classify results as passed, failed, blocked, flaky, invalid, or inconclusive.
- Capture evidence where possible.
- Do not create Jira issues directly unless explicitly configured to do so.

Agent 3: Failure Triage Agent

Responsibilities:

- Read failed, blocked, flaky, invalid, and inconclusive run results.
- Deduplicate failures.
- Decide whether the failure is a real product bug, environment issue, test data issue, invalid scenario, flaky behavior, or needs human review.
- Create or update Jira issues through Jira MCP if available.
- If Jira MCP is not available, produce a local Jira issue payload file.
- Never create duplicate issues for the same root failure.
- Attach scenario ID, run ID, evidence, expected behavior, actual behavior, reproduction steps, severity, and classification.

Agent 4: Implementation Agent

Responsibilities:

- Read Jira issue context, scenario file, and run evidence.
- Inspect source code.
- Implement the smallest safe fix.
- Add or update automated tests where practical.
- Run relevant checks.
- Optionally use Chrome DevTools MCP to manually confirm the fix.
- Move the issue to In Review or Ready for Verification if Jira MCP is available.
- Do not mark the issue Done.
- Do not weaken the scenario to make the issue pass.
- Do not silently delete failing scenarios.

Agent 5: Verification Agent

Responsibilities:

- Rerun the original scenario against the fixed application.
- Prefer black box validation.
- Verify the specific failure from the Jira issue.
- If fixed, mark the issue Done if Jira MCP is available.
- If still failing, reopen or return the issue to In Progress with fresh evidence.
- If flaky, mark as flaky and require repeated runs.
- Do not approve the implementation just because tests pass. The user visible scenario must pass.

7. Implement command line scripts.

The scripts can be lightweight wrappers initially, but they should work.

Required commands:

generate-scenarios
run-scenarios
triage-failures
verify-issue
orchestrate

The exact invocation may depend on the repo stack, but document it clearly.

generate-scenarios:

- Creates initial scenario files or updates existing ones.
- For MVP, this may create example scenarios based on repo inspection and TODO placeholders if the app cannot be run automatically.
- It should not overwrite existing scenarios without preserving content.

run-scenarios:

- Reads scenario files.
- For MVP, if Chrome DevTools MCP automation is not available directly from this script, create a structured execution plan and mark runs as inconclusive with a clear reason.
- If browser automation exists in the repo, use it.
- Always create a run result file.

triage-failures:

- Reads recent failed or inconclusive run results.
- Groups likely duplicates.
- Creates local Jira issue payload files if Jira MCP is not available.
- If Jira integration exists in the repo, use it behind a clean adapter.

verify-issue:

- Accepts a scenario ID or Jira issue key.
- Reruns the linked scenario.
- Writes a verification result.
- Updates Jira if Jira MCP is available, otherwise writes a local verification payload.

orchestrate:

- Runs the MVP loop in a safe order:
  1. generate scenarios
  2. run scenarios
  3. triage failures

- Do not implement uncontrolled infinite loops.
- For now, one orchestration pass is enough.
- Add a config option for future scheduled or webhook based execution.

8. Add configuration.

Create config.example.json with fields like:

{
"appBaseUrl": "[http://localhost:3000](http://localhost:3000)",
"scenarioDirectory": ".agentic-development/scenarios",
"runDirectory": ".agentic-development/scenario-runs",
"jira": {
"enabled": false,
"projectKey": "",
"defaultIssueType": "Bug",
"statuses": {
"readyForVerification": "Ready for Verification",
"done": "Done",
"reopened": "In Progress"
}
},
"mcp": {
"chromeDevTools": {
"enabled": true
},
"jira": {
"enabled": false
}
},
"limits": {
"maxFixAttempts": 2,
"maxVerificationAttempts": 3,
"maxIssuesPerRun": 10
}
}

Also document how to create a real config file, for example:

.agentic-development/config.json

Do not commit secrets.

9. Add local Jira payload fallback.

Because Jira MCP availability may depend on the local agent runtime, implement a fallback directory:

.agentic-development/jira-payloads/

When Jira MCP is unavailable, triage-failures should write issue payloads locally as JSON or markdown.

The payload should contain:

title
description
scenarioId
runId
expected
actual
reproductionSteps
evidence
classification
severity
dedupeKey
labels
suggestedStatus

10. Implement deduplication.

For MVP, implement a simple dedupe key based on:

scenarioId
failureStep
normalized actual outcome
first console error signature if present
first network error signature if present

If a matching local payload already exists, append the new run ID to it instead of creating a duplicate.

11. Add documentation.

The README should explain:

- What Scenario Driven Agentic Development is.
- What “self improving” means in this project.
- What it explicitly does not mean.
- The agent roles.
- The artifact flow.
- The scenario lifecycle.
- The Jira lifecycle.
- How to run the MVP.
- How to integrate Chrome DevTools MCP.
- How to integrate Jira MCP.
- How to safely extend the system.
- Known limitations.

Include this scenario lifecycle:

draft
ready
active
running
passed
regression
failed
jira-created
awaiting-fix
ready-for-verification
verified
blocked
invalid
needs-product-review
deprecated

Include this issue lifecycle:

Open
Triaged
In Progress
In Review
Ready for Verification
Done

With failure path:

Ready for Verification
Reopened
In Progress

12. Add safeguards.

The implementation should include these rules:

- Do not delete scenarios just because they pass.
- Passing scenarios become regression candidates.
- Do not let the implementation agent close Jira issues.
- Do not let the same agent implement and verify its own fix.
- Do not create Jira issues for blocked, invalid, or inconclusive runs unless configured to do so.
- Do not spam Jira with duplicates.
- Do not run infinite autonomous loops by default.
- Do not store secrets in the repo.
- Do not weaken expected outcomes to make failures disappear.
- Do not modify agent prompts automatically as part of the product improvement loop.

13. Add example scenarios.

If the repository structure makes it possible to infer real product flows, create 3 to 5 initial scenarios from the actual app.

If not, create clearly marked example scenarios in:

.agentic-development/scenarios/examples/

Do not pretend example scenarios are real product coverage.

14. Add tests where practical.

Add lightweight tests for:

scenario file parsing
scenario metadata validation
run result writing
failure deduplication
local Jira payload generation

Use the repo’s existing test framework if available.

15. Preserve existing repo conventions.

Before implementing, inspect:

package manager
language
test framework
linting
existing scripts
folder structure
CI configuration
app start command
environment variable conventions

Follow existing conventions.

If there is no clear convention, keep implementation simple and self contained under .agentic-development.

16. Expected final output.

After implementation, provide a summary with:

- Files added or changed.
- Commands added.
- How to run the MVP.
- What is fully implemented.
- What is stubbed because it depends on MCP runtime availability.
- Next recommended steps.

Implementation quality bar:

The result should be usable immediately as a local framework for the first iteration, even if some MCP dependent pieces are adapters or documented stubs.

Do not just create documentation. Implement the file structure, schemas, config, scripts, local payload fallback, and basic validation or tests.

Do not overbuild a platform. Build a clean MVP that can evolve.

System Design Feedback: Crucial Blindspots
As an AI, I've seen many multi-agent workflows break down in practice. Here are a few realities you will need to account for as you build this MVP:

1. Test Data and State Management (The "Cleanup" Problem)
   If your scenario is "Create a new project," and the runner executes this 50 times a week, your database will have 50 garbage projects. Worse, if a scenario requires modifying an existing user's settings, it might break the environment for other scenarios.

Fix: You will eventually need "Teardown" steps in your scenarios, or a way to reset the database/environment before the orchestrator runs the suite.

2. Chrome MCP Flakiness
   You are heavily relying on the Chrome DevTools MCP for the runner. Browser automation driven by LLMs is notoriously flaky due to timing issues, UI rendering delays, and unexpected pop-ups.

Fix: Ensure your Scenario Runner Agent's prompt explicitly instructs it to wait for network idle and check for DOM stability before assuming a button click failed. The "Flaky" status in your JSON schema will be your best friend.

3. The Context Window Trap for the Implementation Agent
   Your Implementation Agent needs to read the source code, the Jira issue, the scenario, and the run evidence. In a large codebase, this will quickly blow up the context window or cause the agent to hallucinate.

Fix: The Triage Agent must be exceptionally good at providing isolated evidence. The Implementation Agent shouldn't try to read the whole repo; it should use semantic search or file-specific reads based on the network errors caught by the Triage Agent.

4. The Orchestrator is the Real Brain
   You noted that file-watching plus webhooks gets messy. You are absolutely right. The scripts/orchestrate file is going to become the most important piece of code in this system. It should operate like a strict state machine. If an agent crashes halfway through a task, the orchestrator needs to know how to pick up where it left off without duplicating a Jira issue.

This is a fantastic initiative, and starting with a tightly scoped MVP is the right call. How are you planning to handle the initial database state and test data so that the Scenario Runner doesn't permanently mutate your local environment during testing?

I've seen many multi-agent workflows break down in practice. Here are a few realities you will need to account for as you build this MVP:

1. Test Data and State Management (The "Cleanup" Problem)
   If your scenario is "Create a new project," and the runner executes this 50 times a week, your database will have 50 garbage projects. Worse, if a scenario requires modifying an existing user's settings, it might break the environment for other scenarios.
   my thoughts: i was thinking of allowing the agent that create the scenarios to provide a path to a script that would run before and after the scenario tester. before it will populate the db and after it will clean it for the next scenario to be ready. maybe create a different db that would be used only by the agents for this reason?
2. Chrome MCP Flakiness
   You are heavily relying on the Chrome DevTools MCP for the runner. Browser automation driven by LLMs is notoriously flaky due to timing issues, UI rendering delays, and unexpected pop-ups.
   my thoughts: i agree that sometimes chrome mcp can be not accurate can we investigate the chrome dev tools mcp vs playwritght mcp?
3. The Context Window Trap for the Implementation Agent
   Your Implementation Agent needs to read the source code, the Jira issue, the scenario, and the run evidence. In a large codebase, this will quickly blow up the context window or cause the agent to hallucinate.
   my thoughts: context window is not the issue. the agents we are going to use are existing high performance coding agents like opencode, claude code and codex. we have to be clear that we are not building the actual agent instead using the existing agents, so we creating something like a wrapper for this automated development. we want their harness so the context windows are safe

You are pushing this architecture in exactly the right direction. These adjustments move the system from a theoretical concept to an engineering pipeline.

---

## 1. Database Isolation & Lifecycle Hooks

Your intuition to use a separate database combined with dynamic setup/teardown hooks is spot-on. If the agent modifies the shared database, the testing pipeline quickly cascades into chaos.

To make this execution-friendly for the Scenario Runner, build those hook paths directly into the **YAML frontmatter** of your scenario files.

### Recommended Execution Path

1. The **Scenario Generator Agent** writes the scenario and points to a corresponding seed file or script.
2. Before running the browser automation, the **Orchestrator** runs the setup hook against your isolated agent-development database (e.g., `db:reset && db:seed --scenario SCN-001`).
3. The **Scenario Runner Agent** executes the test.
4. The **Orchestrator** runs the teardown hook.

```yaml
id: SCN-001
title: Create a new project
hooks:
  setup: npm run db:seed:project-clean
  teardown: npm run db:clean:project-clean
```

Using a dedicated local SQLite database file, a localized Docker container, or an isolated PostgreSQL schema makes wiping and restoring the state near-instantaneous.

---

## 2. Chrome DevTools MCP vs. Playwright MCP

Shifting your tooling choices here will dramatically improve reliability. There is a fundamental difference in how these two official MCP servers operate, making them suited for entirely different roles in your loop.

| Feature                  | Chrome DevTools MCP (`chrome-devtools-mcp`)                                      | Playwright MCP (`@playwright/mcp`)                             |
| ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Primary Underpinning** | Puppeteer / Chrome DevTools Protocol                                             | Microsoft Playwright Engine                                    |
| **How the LLM "Sees"**   | Raw DOM trees, screenshots, pixel-level selection                                | **Accessibility Tree** (Roles, ARIA labels, semantic text)     |
| **Core Strength**        | Deep debugging, performance traces, memory audits, network interception          | Functional end-to-end user testing, multi-browser emulation    |
| **Flakiness Risk**       | **High** (Dynamic selectors change; LLMs struggle with large, complex DOM trees) | **Low** (Interacts like a screen reader; ignores visual noise) |

### The Hybrid Playbook for Your System

- **For the Scenario Runner & Verification Agents (Black Box):** Use **Playwright MCP**. Because it serves the LLM a clean accessibility tree instead of raw HTML code, the agent doesn't get distracted by deep nested `<div>` selectors or CSS class changes. It clicks "Button [name='Save']" exactly like a human user or screen reader would. It also handles isolated browser states (`--isolated`) and saves local storage/cookies out-of-the-box using the `--storage-state` flag.
- **For the Triage & Implementation Agents (White Box):** Keep **Chrome DevTools MCP** available. When a Playwright run fails, these agents can attach to the session to run console audits, pull performance trace logs, or deeply inspect network errors to see exactly _why_ the endpoint choked.

---

## 3. Leveraging Pre-Built Agent Frameworks

This clarification shifts the scope of your project. Knowing you are treating existing elite developer tools (like **Claude Code**, **OpenCode**, or **Codex**) as your underlying engine—rather than managing raw LLM API context windows from scratch—means your wrapper only needs to handle the _system pipeline and constraints_.

These specialized clients already possess advanced built-in orchestration harnesses:

- They handle semantic code search (grep, ripgrep tools).
- They chunk and index large codebases automatically.
- They use agentic tool-calling loops to self-correct terminal or compilation errors.

### The Role of Your Wrapper

Your framework doesn't need to feed raw files into a prompt. Instead, your orchestration scripts (`scripts/implement-fix`, `scripts/run-scenarios`) simply launch an instance of your chosen engine inside the right directory context, with the correct MCP servers exposed, and pass a highly targeted terminal command or context file.

> **Example Workflow:**
> When a failure occurs, your orchestrator invokes Claude Code via CLI:
> `claude "Read .agentic-development/scenarios/SCN-001.md and the error log at .agentic-development/scenario-runs/run-123.json. Use your codebase access to find and fix the bug. Do not update the scenario."`

---

## Updated Structure for Your Claude Code / Codex Prompt

When you hand the implementation prompt over to your AI assistant, append these updated architecture adjustments to ensure it sets up the infrastructure properly:

```text
ADDITIONAL ARCHITECTURE REQUIREMENTS FOR MVP IMPLEMENTATION:

1. Database Sandbox & Script Hooks:
   - Update the scenario YAML frontmatter schema to optionally include `hooks.setup` and `hooks.teardown` string commands.
   - Document in the README that the orchestration script must execute these environment/database commands immediately before and after invoking the Scenario Runner.

2. MCP Differentiation:
   - Configure the Scenario Runner and Verification Agents to explicitly use the Microsoft Playwright MCP (`@playwright/mcp`) server to benefit from semantic accessibility tree navigation.
   - Configure the Triage and Implementation Agents to utilize the Chrome DevTools MCP (`chrome-devtools-mcp`) when deep debugging, console evaluation, or performance/network tracking is required.

3. Harness Integration:
   - Ensure that the execution scripts in `scripts/` act as command-line wrappers designed to launch and orchestrate premium existing coding agents (such as Claude Code, OpenCode, or Codex) by providing them with file paths, targeted tasks, and localized environment variables rather than raw, manual context assembly.

```

This strategy reduces developer overhead. You are creating the operational rails, state management, and quality control metrics, while letting world-class developer agents do the heavy lifting.

How do you plan to handle the communication between your orchestrator script and your Jira instance—will you use a polling loop on a cron schedule, or spin up an internal webhook receiver?
