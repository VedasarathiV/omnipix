// Verify recipes (#8): named, reviewed shell-check bundles for coding evals.
// Suites can attach `recipe` names instead of hand-writing shell commands;
// the route expands them into plain `shell` checks at save time, so grading
// stays untouched. Commands run inside the seeded workspace through the same
// sandboxed shell path as any other shell check — the recipe is a shortcut,
// not a new capability.

export interface VerifyRecipe {
  name: string;
  description: string;
  commands: string[];
}

const RECIPES: VerifyRecipe[] = [
  {
    name: 'pytest',
    description: 'Run the Python test suite (pytest).',
    commands: ['python3 -m pytest -q'],
  },
  {
    name: 'npm-test',
    description: 'Run the Node test suite (npm test).',
    commands: ['npm test -- --silent'],
  },
  {
    name: 'tsc',
    description: 'Type-check a TypeScript project without emitting.',
    commands: ['npx --no-install tsc --noEmit'],
  },
  {
    name: 'go-test',
    description: 'Run the Go test suite for all packages.',
    commands: ['go test ./...'],
  },
  {
    name: 'cargo-test',
    description: 'Run the Rust test suite.',
    commands: ['cargo test --quiet'],
  },
  {
    name: 'vitest-run',
    description: 'Run a Vitest suite once (CI mode).',
    commands: ['npx --no-install vitest run'],
  },
];

const BY_NAME = new Map(RECIPES.map(r => [r.name, r]));

export function listVerifyRecipes(): VerifyRecipe[] {
  return RECIPES.map(r => ({ ...r, commands: [...r.commands] }));
}

export function getVerifyRecipe(name: string): VerifyRecipe | null {
  const found = BY_NAME.get(name.trim());
  return found ? { ...found, commands: [...found.commands] } : null;
}
