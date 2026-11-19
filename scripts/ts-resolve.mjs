/**
 * ts-resolve — a Node module-resolution hook so scripts can load extensionless src/ imports.
 *
 * Purpose
 *   src/ modules import siblings without an extension ('./palette') the way Vite resolves them
 *   in the browser; Node's native TypeScript loading does not. This hook lets
 *   `node scripts/*.ts` load them unchanged.
 *
 * Operations
 *   registerHooks adds a resolve step: it tries normal resolution first and, only when that
 *   throws ERR_MODULE_NOT_FOUND for a relative specifier with no extension, retries with `.ts`
 *   appended. Everything else (bare packages, specifiers with extensions) is untouched.
 *
 * Usage
 *   Preload it: `node --import ./scripts/ts-resolve.mjs scripts/check-xxx.ts`. The package.json
 *   `check` script does this for dog-path, trees, rivers, islands and names; check-controls,
 *   check-tiers and check-sky-frame run without it.
 *
 * See also: package.json (`check`); DESIGN.md "17. Checks and tooling".
 */
import { registerHooks } from 'node:module';
registerHooks({
    resolve(specifier, context, next) {
        try {
            return next(specifier, context);
        } catch (err) {
            if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.[a-z]+$/i.test(specifier)) throw err;
            return next(specifier + '.ts', context);
        }
    },
});
