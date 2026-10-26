// Shared declarations for type checking (tsc --noEmit). Not part of the extension.
// common.js sets the read-only global __dgt with defineProperty, which tsc can't infer.
declare const __dgt: typeof import('../extension/common.js');
// common.js also exports its API under Node for the unit tests.
declare var module: any;
