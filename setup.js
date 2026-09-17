// Forwarder for older instructions that say "node setup.js". The real
// installer is setup.cjs: newer SillyTavern roots set "type": "module",
// which would make Node parse a CommonJS .js file as an ES module and
// break require(). Dynamic import() works whether THIS file is loaded
// as CommonJS or ESM, so it reaches setup.cjs in both kinds of installs.
import('./setup.cjs').catch(error => {
    console.error(`[InnerLore] ${error?.stack || error}`);
    process.exit(1);
});
