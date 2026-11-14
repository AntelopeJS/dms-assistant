import * as Builder from "@antelopejs/interface-dms-builder";
import { expect } from "chai";

/**
 * The interface exports one function per operation. A caller that picks an
 * operation by name reads `Operations`, so an operation missing from it is an
 * operation that caller can never reach.
 */
/** The interface's exports that are not operations: the map itself and its constants. */
const NOT_OPERATIONS = new Set(["Operations", "DATABASE_ENGINE_SCHEMES"]);

describe("operation map", () => {
  it("holds every operation the interface exports, by the name it is exported under", () => {
    const exported = new Map(
      Object.entries(Builder).filter(([name]) => !NOT_OPERATIONS.has(name)),
    );
    expect(Object.keys(Builder.Operations).sort()).to.deep.equal(
      [...exported.keys()].sort(),
    );
    for (const [name, operation] of Object.entries(Builder.Operations)) {
      expect(operation, name).to.equal(exported.get(name));
    }
  });
});
