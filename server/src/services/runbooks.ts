import type { TaskGuardrail, TaskInput } from './agent-orchestrator.js';

// Runbook team presets (orchestration #5): curated task graphs with roles,
// contracts, and guardrails, so a team starts from a proven shape instead
// of a blank page. Shaped after agency-agents runbooks (startup-mvp,
// incident-response), rewritten for our contract schema. Task goals may
// embed {{goal}} — resolveRunbook substitutes the group goal.

export interface RunbookPreset {
  name: string;
  description: string;
  tasks: TaskInput[];
}

const JUDGE = (prompt: string): TaskGuardrail => ({ type: 'llm_judge', prompt });

const RUNBOOKS: RunbookPreset[] = [
  {
    name: 'startup-mvp',
    description: 'Spec, build, review, verify — ship the smallest working thing.',
    tasks: [
      {
        name: 'spec', role: 'planner',
        goal: 'Write a build spec for: {{goal}}. Cover scope, data model, file/API layout, and acceptance criteria.',
        expectedOutput: 'A spec covering scope, data model, layout, and acceptance criteria.',
        guardrail: JUDGE('The spec covers scope, data model, file/API layout, and acceptance criteria.'),
      },
      {
        name: 'build', role: 'coder',
        goal: 'Implement the spec. Keep it minimal but working.',
        dependsOn: [0],
        expectedOutput: 'A working implementation of every spec item.',
        inputs: [{ name: 'spec', from: 0 }],
        guardrail: JUDGE('The implementation covers every spec item and runs without errors.'),
      },
      {
        name: 'review', role: 'reviewer',
        goal: 'Review the build for correctness and security issues.',
        dependsOn: [1],
        expectedOutput: 'A review with concrete findings, or a clean bill.',
        inputs: [{ name: 'build', from: 1 }],
      },
      {
        name: 'verify', role: 'tester',
        goal: 'Verify the build meets the spec. Run any repo checks that exist.',
        dependsOn: [1],
        expectedOutput: 'A verification report: what was checked and what passed.',
        inputs: [{ name: 'build', from: 1 }],
      },
    ],
  },
  {
    name: 'code-review',
    description: 'Read, critique, verify — a review crew for a change or repo.',
    tasks: [
      {
        name: 'read', role: 'researcher',
        goal: 'Read the change under review for: {{goal}}. Summarize what it does, file by file.',
        expectedOutput: 'A file-by-file summary of the change.',
      },
      {
        name: 'critique', role: 'reviewer',
        goal: 'Critique the change for correctness, security, and maintainability. Every finding cites file and line.',
        dependsOn: [0],
        expectedOutput: 'Findings with file/line citations, or a clean bill.',
        inputs: [{ name: 'summary', from: 0 }],
      },
      {
        name: 'verify', role: 'tester',
        goal: 'Run the repo checks (tests, lint, typecheck) that cover the change.',
        dependsOn: [0],
        expectedOutput: 'Check results: what ran, what passed, what failed.',
        inputs: [{ name: 'summary', from: 0 }],
      },
    ],
  },
  {
    name: 'research-sweep',
    description: 'Survey, compare, recommend — parallel research that converges.',
    tasks: [
      {
        name: 'survey', role: 'researcher',
        goal: 'Survey the landscape for: {{goal}}. Gather candidates with sources.',
        expectedOutput: 'A sourced list of candidates.',
      },
      {
        name: 'compare', role: 'planner',
        goal: 'Compare the surveyed candidates on cost, fit, and risk. Build the comparison table.',
        dependsOn: [0],
        expectedOutput: 'A comparison table with a ranked shortlist.',
        inputs: [{ name: 'survey', from: 0 }],
      },
      {
        name: 'recommend', role: 'reviewer',
        goal: 'Stress-test the shortlist and write the final recommendation with trade-offs.',
        dependsOn: [1],
        expectedOutput: 'A recommendation with trade-offs and next steps.',
        inputs: [{ name: 'comparison', from: 1 }],
        guardrail: JUDGE('The recommendation names a winner, cites evidence, and states trade-offs.'),
      },
    ],
  },
  {
    name: 'incident-response',
    description: 'Triage, mitigate, verify, retro — run an incident with discipline.',
    tasks: [
      {
        name: 'triage', role: 'researcher',
        goal: 'Gather symptoms, scope, and timeline for: {{goal}}.',
        expectedOutput: 'Incident scope, affected surface, and timeline.',
      },
      {
        name: 'mitigate', role: 'coder',
        goal: 'Stop the bleeding: apply the smallest safe mitigation first.',
        dependsOn: [0],
        expectedOutput: 'Mitigation applied, or concrete playbook steps when hands-on access is missing.',
        inputs: [{ name: 'triage', from: 0 }],
      },
      {
        name: 'verify', role: 'tester',
        goal: 'Confirm the service is healthy after mitigation.',
        dependsOn: [1],
        expectedOutput: 'Health confirmation with the checks that prove it.',
        inputs: [{ name: 'mitigation', from: 1 }],
        guardrail: JUDGE('The report names specific health checks and their outcomes.'),
      },
      {
        name: 'retro', role: 'planner',
        goal: 'Write the retro: root cause, timeline, and prevention actions.',
        dependsOn: [2],
        expectedOutput: 'A retro with root cause and dated prevention actions.',
        inputs: [{ name: 'verification', from: 2 }],
      },
    ],
  },
];

export function listRunbooks(): RunbookPreset[] {
  return RUNBOOKS.map(r => ({ ...r, tasks: r.tasks.map(t => ({ ...t })) }));
}

/** Resolve a preset by name, substituting {{goal}}. Null when unknown. */
export function resolveRunbook(name: string, goal: string): TaskInput[] | null {
  const preset = RUNBOOKS.find(r => r.name === name.trim().toLowerCase());
  if (!preset) return null;
  const fill = (text: string): string => text.replaceAll('{{goal}}', goal);
  return preset.tasks.map(task => ({
    ...task,
    goal: fill(task.goal),
    expectedOutput: task.expectedOutput ? fill(task.expectedOutput) : undefined,
    inputs: task.inputs?.map(w => ({ ...w })),
    guardrail: task.guardrail ? { ...task.guardrail } : undefined,
  }));
}
