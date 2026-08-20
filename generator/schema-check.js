/**
 * A dependency-free JSON Schema checker for the keyword subset the proof
 * contracts use: type, const, enum, pattern, minLength, minItems, required,
 * properties, items (single schema OR tuple), $ref (to #/$defs/*), allOf,
 * if/then/else. It is NOT a general validator — it implements only what the
 * schemas in schemas/ rely on, and is exercised against them in tests.
 *
 * Structure only. Cross-field semantics live in validate.js.
 */
const fs = require("fs");

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v; // "number" | "string" | "boolean" | "object"
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (t === want) return true;
  if (want === "number") return t === "integer" || t === "number";
  return false;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref "${ref}"`);
  return ref
    .slice(2)
    .split("/")
    .reduce((o, k) => (o == null ? o : o[k]), root);
}

// Returns an array of { path, message }. Empty = valid.
function check(schema, data, root = schema, path = "") {
  if (schema.$ref) return check(resolveRef(schema.$ref, root), data, root, path);

  const errs = [];
  const push = (msg) => errs.push({ path: path || "(root)", message: msg });

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, data))) {
      push(`expected ${types.join(" | ")}, got ${typeOf(data)}`);
      return errs; // type is the gate — downstream keyword checks would be noise
    }
  }

  if ("const" in schema && JSON.stringify(data) !== JSON.stringify(schema.const)) {
    push(`must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(data))) {
    push(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }

  if (typeOf(data) === "string") {
    if (schema.minLength != null && data.length < schema.minLength) {
      push(`shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      push(`does not match /${schema.pattern}/`);
    }
  }

  if (typeOf(data) === "array") {
    if (schema.minItems != null && data.length < schema.minItems) {
      push(`fewer than minItems ${schema.minItems}`);
    }
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub, i) => {
        if (i < data.length) errs.push(...check(sub, data[i], root, `${path}[${i}]`));
      });
    } else if (schema.items) {
      data.forEach((v, i) => errs.push(...check(schema.items, v, root, `${path}[${i}]`)));
    }
  }

  if (typeOf(data) === "object") {
    for (const key of schema.required || []) {
      if (!(key in data)) push(`missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in data) errs.push(...check(sub, data[key], root, path ? `${path}.${key}` : key));
    }
  }

  for (const sub of schema.allOf || []) errs.push(...check(sub, data, root, path));

  if (schema.if) {
    const branch = check(schema.if, data, root, path).length === 0 ? schema.then : schema.else;
    if (branch) errs.push(...check(branch, data, root, path));
  }

  return errs;
}

function checkFile(schemaPath, data) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  return check(schema, data);
}

module.exports = { check, checkFile };
