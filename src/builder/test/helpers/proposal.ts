import { expect } from "chai";
import type {
  MappingProposal,
  ProposedResource,
} from "@antelopejs/interface-dms-builder";

/** The proposed resource that maps `relation`, failing the spec when the proposal has none. */
export function resource(
  proposal: MappingProposal,
  relation: string,
): ProposedResource {
  const found = proposal.resources.find(
    (candidate) => candidate.relation === relation,
  );
  expect(found, relation).to.not.equal(undefined);
  return found!;
}

/** The proposed field that maps `column`, failing the spec when the resource has none. */
export function field(resource: ProposedResource, column: string) {
  const found = resource.fields.find(
    (candidate) => candidate.column === column,
  );
  expect(found, column).to.not.equal(undefined);
  return found!;
}
