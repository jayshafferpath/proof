/**
 * Wire-contract negotiation for proof payloads.
 *
 * Every payload self-identifies with a `contract` tag of the form
 * `proof.<name>/v<major>`. A consumer declares the majors it speaks and fails
 * closed on anything else — an unknown or too-new contract is a precondition
 * error, never a best-effort parse. See docs/contracts.md.
 *
 * Major is the only version in the wire tag; additive (minor) changes keep the
 * major and MUST be ignored by older consumers. Breaking changes bump the major
 * and get a new contract document.
 */
const SUPPORTED = {
  "proof.ledger": [1],
  "proof.spine": [1, 2],
};

function parseContract(tag) {
  const m = /^(proof\.[a-z]+)\/v(\d+)$/.exec(tag || "");
  return m ? { name: m[1], major: Number(m[2]) } : null;
}

// Resolve `tag` against the contract this consumer expects. Returns
// { name, major, assumed? } or throws a named, actionable error.
function negotiate(tag, expectName, opts = {}) {
  if (!tag) {
    if (opts.defaultMajor == null) {
      throw new Error(`missing "contract" field (expected ${expectName}/v<major>)`);
    }
    return { name: expectName, major: opts.defaultMajor, assumed: true };
  }
  const c = parseContract(tag);
  if (!c) throw new Error(`unrecognized contract "${tag}" (want ${expectName}/v<major>)`);
  if (c.name !== expectName) {
    throw new Error(`contract "${tag}" is a ${c.name} payload — this tool speaks ${expectName}`);
  }
  const speaks = SUPPORTED[expectName] || [];
  if (!speaks.includes(c.major)) {
    throw new Error(
      `${tag} is not supported here — this tool speaks ${expectName}/v${speaks.join(", v")}`,
    );
  }
  return c;
}

module.exports = { SUPPORTED, parseContract, negotiate };
