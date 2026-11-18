// Declarations for type checking the background worker (tsc --noEmit). Not part of the extension.
// background.js loads alarm-rules.js with importScripts, which tsc can't follow.
declare const dgAlarmRules: typeof import('../extension/alarm-rules.js');
// alarm-rules.js also exports its API under Node for the unit tests.
declare var module: any;
