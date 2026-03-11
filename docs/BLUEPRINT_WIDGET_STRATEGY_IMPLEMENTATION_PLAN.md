# Blue-Print Strategic Widget Builder Implementation Plan

## Goal

Make Blue-Print plan ahead before tool execution by turning Stove into a controlled planning and build pipeline:

`Idea -> verified plan -> widget blueprint -> readiness scoring -> registry save -> dashboard render -> workbench instructions -> activation`

This plan preserves the current architecture instead of replacing it.

## Verified Current State

### What already exists

- Backend widget manifests already exist and are validated in `lib/blueprint/services/manifest_service.js`.
- Runtime widget dependency checks already exist in `lib/blueprint/services/widget_runner_service.js`.
- Stove already compiles task intent into a session manifest in `lib/blueprint/services/widget_rendering_stove_service.js`.
- Reviewer guardrails already exist in `lib/blueprint/services/reviewer_service.js`.
- Connector availability and auth checks already exist in `lib/blueprint/services/connector_service.js`.
- The homepage already exposes:
  - Strategic Workbench
  - Stove
  - ToolBox registry cards
  - Browser -> Stove task handoff
  in `Contents/Resources/Homepage.html`.
- Control-plane signal parsing for tool calls already exists in `Blue/shared/agentc-control/assistant.js` and `Blue/shared/agentc-control/commands.js`.

### What is missing

- There is no first-class planning artifact for a tool run or widget build.
- Tool `RUN` requests can be proposed directly from natural language without a required preflight plan.
- Stove tool execution in `Blue/tool-control-plane/src/services/tool_executors.js` only produces a lightweight blueprint/code preview. It does not verify readiness, save a controlled manifest, or enforce activation gates.
- The homepage maintains a separate local ToolBox registry in `Contents/Resources/Homepage.html`, while the backend keeps widget manifests in `lib/blueprint/services/manifest_service.js`. That creates two sources of truth.
- Current manifests do not model:
  - vision
  - functions
  - commands
  - conditions
  - required APIs as readiness items
  - security verification
  - load/readiness percentage
- Activation is not blocked by a 100% readiness contract.

## Recommended Direction

Do not add a third system.

Use the backend widget manifest registry as the source of truth, and make Workbench/Stove/ToolBox operate on the same planned widget record.

## Target Architecture

### 1. Planning artifact

Add a new planning object, separate from the runtime session manifest:

- `WidgetStrategyPlan`
- `ToolExecutionPlan`

`WidgetStrategyPlan` should represent the build state of a widget.

`ToolExecutionPlan` should represent the preflight state of a tool call.

### 2. Controlled widget lifecycle

Each widget should move through:

- `idea_received`
- `vision_defined`
- `functions_mapped`
- `conditions_defined`
- `apis_scanned`
- `security_verified`
- `registry_saved`
- `ready`
- `active`

Only `ready` widgets can be activated.

### 3. One registry path

Unify this flow:

- Workbench writes plan state
- Stove verifies and compiles
- Registry stores the controlled manifest
- Dashboard renders from registry
- Workbench attaches instructions
- Activation flips status to `active`

The frontend ToolBox registry should become a view/cache of backend manifests, not a parallel registry.

## Proposed Schema Additions

Extend the current widget manifest shape with a build envelope:

```json
{
  "widgetId": "client-refund-assistant",
  "name": "Client Refund Assistant",
  "title": "Client Refund Assistant",
  "version": "1.0.0",
  "purpose": "Verify duplicate charge claims and prepare guarded refund actions.",
  "vision": {
    "layout": "chat_panel_with_actions",
    "interactionStyle": "guided_assistant",
    "preview": "ascii_or_structured_preview"
  },
  "functions": {
    "inputHandler": ["receive client message"],
    "logicEngine": ["detect duplicate charge", "decide refund or escalate"],
    "apiCalls": ["payment_processor_api", "email_service_api", "database_lookup"],
    "responseBuilder": ["draft reply", "draft confirmation"],
    "actionExecution": ["issue_refund", "escalate_case"]
  },
  "commands": [
    "trigger:on_message",
    "condition:duplicate_charge",
    "action:issue_refund",
    "fallback:email_support"
  ],
  "conditions": [
    {
      "id": "duplicate_charge",
      "expression": "payment.duplicate_charge == true",
      "onPass": "issue_refund",
      "onFail": "escalate_case"
    }
  ],
  "requiredApis": [
    {
      "id": "stripe",
      "kind": "connector",
      "status": "missing"
    }
  ],
  "security": {
    "vaultRefsRequired": true,
    "plainSecretsAllowed": false,
    "verified": false
  },
  "readiness": {
    "vision": 100,
    "functions": 100,
    "commands": 80,
    "apis": 40,
    "security": 100,
    "overall": 84,
    "status": "draft"
  },
  "route": "/tools/client-refund-assistant",
  "status": "draft"
}
```

## Service Design

### New backend services

- `lib/blueprint/services/widget_strategy_service.js`
  - verify idea
  - derive purpose
  - build vision block
  - map functions
  - normalize commands/conditions
  - prepare a draft controlled manifest

- `lib/blueprint/services/widget_readiness_service.js`
  - calculate readiness percentages
  - determine missing APIs
  - determine missing security requirements
  - return activation blockers

- `lib/blueprint/services/tool_execution_plan_service.js`
  - build a preflight plan for tool calls
  - list steps, dependencies, risks, reviewer state, approval requirements
  - require plan approval before mutating tool runs

### Existing services to extend

- `lib/blueprint/services/manifest_service.js`
  - validate the extended manifest schema
  - enforce readiness block before `status=active`

- `lib/blueprint/services/widget_rendering_stove_service.js`
  - consume planned manifests
  - surface readiness/load metadata in the session handoff
  - reject rendering of unregistered or not-ready widgets when activation is requested

- `lib/blueprint/services/connector_service.js`
  - expose structured API readiness reports

- `lib/blueprint/services/reviewer_service.js`
  - review commands and conditions in addition to prompt text

## API Changes

Add new Stove endpoints instead of overloading the current session endpoint:

- `POST /api/stove/plans`
  - verify idea
  - return `WidgetStrategyPlan`

- `POST /api/stove/readiness`
  - calculate readiness and missing requirements

- `POST /api/stove/activate`
  - only succeeds when readiness is 100

Keep:

- `POST /api/stove/session`
  - runtime widget session composition only

This keeps build-time planning and run-time rendering separate.

## Control-Plane Rule For Tool Calling

### Current problem

Natural language can currently become a `TOOL|RUN` proposal directly.

### Recommended rule

All tool runs except safe reads must go through a preflight plan.

#### Safe direct execution

Keep direct execution only for:

- `TOOL|STATUS`
- `SYNC|LOAD`
- `TEST|PING`

#### Planned execution required

Require a `ToolExecutionPlan` first for:

- `TOOL|RUN`
- `TOOL|RESTART`
- `TOOL|STOP`
- any route mutation
- any browser/system/server operation with side effects

### Implementation point

Extend:

- `Blue/shared/agentc-control/assistant.js`
- `Blue/tool-control-plane/src/services/control_plane_service.js`

So the flow becomes:

`natural language -> canonical signal -> execution plan -> confirmation/readiness -> execution`

Not:

`natural language -> direct tool run proposal`

## Frontend Changes

### Strategic Workbench

Upgrade Workbench from text planner to plan editor:

- show widget purpose
- show vision preview
- show function mapping
- show commands
- show conditions
- show required APIs
- show readiness/load bar
- show activation blockers

### Stove

Add Stove mode toggle:

- `Design`
- `Build`
- `Repair`
- `Inspect`

`Design` should create/update plans only.

`Build` should save verified manifests.

`Repair` should inspect an existing manifest and missing dependencies.

`Inspect` should show readiness and activation blockers without changing state.

### ToolBox

ToolBox cards should render backend manifest readiness:

- `DRAFT`
- `READY`
- `ACTIVE`
- readiness percentage
- missing APIs
- missing security

## Data Model Notes

The in-memory store in `lib/blueprint/db.js` and the Prisma `WidgetManifest` model are currently too small for this workflow.

Minimum expansion:

- manifest metadata JSON for:
  - purpose
  - vision
  - functions
  - commands
  - conditions
  - required API scan
  - security state
  - readiness
- optional separate `WidgetPlan` table/collection for revision history

Recommended approach:

- Keep `WidgetManifest` as the deployable artifact
- Add `WidgetPlan` as the design-time artifact

That avoids polluting active manifests with every draft revision.

## Reuse Rules

Finished widgets must be reusable in future plans.

Add reuse matching by:

- `purpose`
- `category`
- `commands`
- `required APIs`
- `route`

Before creating a new widget plan, the planner should check if a matching active or ready widget already exists and return:

- `reuse_existing`
- `extend_existing`
- `create_new`

## Email Signal Integration

The `BP|TYPE|ACTION|TARGET` contract already fits this system.

Recommendation:

- email signal -> parse canonical command
- command -> build plan
- plan -> readiness / review
- execution only after approval or safe direct rule

Do not let email signals bypass the planning layer.

## Delivery Phases

### Phase 1: Backend planning contract

- Add `widget_strategy_service`
- Add `widget_readiness_service`
- Add `POST /api/stove/plans`
- Add readiness model to manifests
- Add tests for readiness scoring and activation blocking

### Phase 2: Registry unification

- Make homepage ToolBox read backend manifest data
- keep `localStorage` only for layout and view state
- stop treating browser-local tool manifests as the authoritative registry

### Phase 3: Control-plane preflight

- Add `tool_execution_plan_service`
- change control-plane `TOOL|RUN` flow to plan first
- preserve direct safe execution only for non-mutating actions

### Phase 4: Workbench/Stove UX

- add readiness/load bars
- add missing API scanner
- add Stove modes
- add activation blockers and READY state

### Phase 5: Reuse and activation hardening

- add reuse detection
- add widget revision history
- add activation approval path

## Test Plan

Add tests for:

- manifest validation rejects activation when readiness < 100
- planner returns partial readiness when APIs are missing
- planner returns partial readiness when security is incomplete
- `TOOL|RUN` creates a preflight plan before execution
- safe commands still execute directly
- frontend renders readiness/load percentages
- existing `POST /api/stove/session` behavior is preserved
- registry save -> dashboard render -> workbench attach -> activation flow

## Recommended First Build Slice

Implement this first because it gives the most leverage with the least breakage:

1. Extend backend manifest schema with `purpose`, `commands`, `conditions`, `requiredApis`, `security`, and `readiness`.
2. Add `widget_readiness_service.js`.
3. Add `POST /api/stove/plans`.
4. Make activation fail unless readiness is 100.
5. Change control-plane `TOOL|RUN` to require a preflight plan artifact.

That gives Blue-Print a real planning layer before tool execution without rewriting the current runtime.
