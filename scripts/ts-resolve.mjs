// Lets `node scripts/*.ts` load src/ modules, which import siblings without
// an extension ('./palette') the way Vite resolves them in the browser.
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
