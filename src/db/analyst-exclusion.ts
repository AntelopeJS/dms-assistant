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
 * The fields Analyst never reads on one data route, whichever table view
 * reads that route. One list for the project, in no tenant.
 */
@RegisterTable(ANALYST_EXCLUSIONS_TABLE, DMS_AI_SCHEMA_NAME)
class AnalystExclusion extends Table {
  @Field("string") declare _id: string;
  @Field("string") declare route: string;
  @Field(["string"]) declare fields: string[];
}

class AnalystExclusionModel extends BasicDataModel(
  AnalystExclusion,
  ANALYST_EXCLUSIONS_TABLE,
) {}

/** A data route and the fields excluded on it, as stored. */
export interface StoredExclusion {
  _id: string;
  route: string;
  fields: string[];
}

/** What the module does with the exclusion list. */
interface AnalystExclusionStore {
  get(id: string): PromiseLike<StoredExclusion | undefined>;
  getAll(): PromiseLike<StoredExclusion[]>;
  insert(entry: StoredExclusion): Promise<string[]>;
  update(id: string, entry: { fields: string[] }): Promise<number>;
  delete(id: string): Promise<number>;
}

/**
 * The project's one exclusion list: one entry per data route, its id derived
 * from the route.
 */
export function analystExclusions(): AnalystExclusionStore {
  return GetModel(AnalystExclusionModel);
}
