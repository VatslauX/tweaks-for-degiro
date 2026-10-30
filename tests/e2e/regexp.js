// Shared by the e2e specs: build a RegExp from a literal string (version numbers, chip labels like "$").

/** escape every RegExp special character, so the string matches only itself */
const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegExp };
