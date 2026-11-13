import type { ProjectConfigStep } from "@antelopejs/interface-dms-builder";
import { type ConfigDraft, refuse } from "./project-config";
import {
  addModule,
  createLocalModule,
  writeEntry,
} from "./project-config-entry";
import { removeConnection, removeModule } from "./project-config-remove";

type StepOp = ProjectConfigStep["op"];

type StepsByOp = { [Op in StepOp]: Extract<ProjectConfigStep, { op: Op }> };

type StepHandlers = {
  [Op in StepOp]: (draft: ConfigDraft, step: StepsByOp[Op]) => void;
};

const STEPS: StepHandlers = {
  AddModule: (draft, step) => addModule(draft, step.id, step.entry),
  ConfigureModule: (draft, step) => writeEntry(draft, step.id, step.entry),
  CreateLocalModule: createLocalModule,
  RemoveModule: removeModule,
  RemoveConnection: removeConnection,
};

function runStep<Op extends StepOp>(
  draft: ConfigDraft,
  op: Op,
  step: StepsByOp[Op],
): void {
  STEPS[op](draft, step);
}

/** Applies one step to the draft, or throws a `StepRefusal` saying why it cannot. */
export function applyStep(draft: ConfigDraft, step: ProjectConfigStep): void {
  if (!Object.hasOwn(STEPS, step.op)) {
    refuse(`unknown step "${String(step.op)}"`);
  }
  runStep(draft, step.op, step);
}
