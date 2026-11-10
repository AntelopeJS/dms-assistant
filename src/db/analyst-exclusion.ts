import {
  BasicDataModel,
  Field,
  GetModel,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { DMS_AI_SCHEMA_NAME } from "../constants/database";

const ANALYST_EXCLUSIONS_TABLE = "analyst_exclusions";

/**
 * A field Analyst never reads on a data route, whichever table view reads
 * that route. One list for the project, in no tenant.
 */
@RegisterTable(ANALYST_EXCLUSIONS_TABLE, DMS_AI_SCHEMA_NAME)
class AnalystExclusion extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare route: string;
  @Field("string") declare field: string;
}

class AnalystExclusionModel extends BasicDataModel(
  AnalystExclusion,
  ANALYST_EXCLUSIONS_TABLE,
) {}

/** What the module does with the exclusion list. */
interface AnalystExclusionStore {
  getAll(): PromiseLike<{ _id: string; route: string; field: string }[]>;
  insert(entry: { route: string; field: string }): Promise<string[]>;
  delete(id: string): Promise<number>;
}

/** The project's one exclusion list. */
export function analystExclusions(): AnalystExclusionStore {
  return GetModel(AnalystExclusionModel);
}
