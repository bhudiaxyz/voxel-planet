/**
 * Global.d — ambient type declarations for the project.
 *
 * Purpose
 *   Lets TypeScript accept imports of plain-JS modules that have no type information.
 *
 * Operations
 *   `declare module '*.js'` makes every import ending in .js resolve to `any`. This is
 *   intentional while any JS files remain untyped. Declaration only; emits no code.
 *
 * Usage
 *   Picked up automatically by tsc through the project include; nothing imports it.
 *
 * See also: tsconfig.json; DESIGN.md "17. Checks and tooling".
 */
declare module '*.js';
