// Variable scopes for `const`/`let` with block scoping.
// Built-ins and tools live in a protected root scope and cannot be redefined.

import { assertLabeled } from "./labeled.js";
import { PlanReferenceError, PlanTypeError } from "./errors.js";

export const BindingKind = Object.freeze({
  Const: "const",
  Let: "let",
  Builtin: "builtin",
});

export class Scope {
  /** @param {Scope|null} parent */
  constructor(parent = null) {
    this.parent = parent;
    this.bindings = new Map();
  }

  child() {
    return new Scope(this);
  }

  declare(name, kind, value, node) {
    assertLabeled(value, `declaration of ${name}`);
    if (this.bindings.has(name)) {
      throw new PlanTypeError(`Identifier '${name}' has already been declared`, { node });
    }
    const builtin = this.findBinding(name);
    if (builtin?.kind === BindingKind.Builtin) {
      throw new PlanTypeError(`cannot redefine built-in '${name}'`, { node });
    }
    this.bindings.set(name, { kind, value });
  }

  lookup(name, node) {
    const binding = this.findBinding(name);
    if (!binding) throw new PlanReferenceError(`${name} is not defined`, { node });
    return binding.value;
  }

  assign(name, value, node) {
    assertLabeled(value, `assignment to ${name}`);
    const binding = this.findBinding(name);
    if (!binding) throw new PlanReferenceError(`${name} is not defined`, { node });
    if (binding.kind === BindingKind.Builtin) {
      throw new PlanTypeError(`cannot reassign built-in '${name}'`, { node });
    }
    if (binding.kind === BindingKind.Const) {
      throw new PlanTypeError(`Assignment to constant variable '${name}'`, { node });
    }
    binding.value = value;
  }

  findBinding(name) {
    for (let scope = this; scope; scope = scope.parent) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
    }
    return null;
  }

  /** Names declared directly in this scope (for inspection and tests). */
  entries() {
    return new Map([...this.bindings].map(([name, b]) => [name, b.value]));
  }
}
