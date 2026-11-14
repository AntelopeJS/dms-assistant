import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { type QueryValue, queryText } from "../../routes/query-text";
import {
  AnalyseDatabase,
  type AnalyseDatabaseInput,
  CheckDatabaseConnection,
  ConfigureProject,
  type ConfigureProjectOpts,
  type DatabaseCheckInput,
  GetAnalysis,
  GetDatabaseConnection,
  GetDatabaseProject,
  GetLatestAnalysis,
  GetMapping,
  ListDatabaseConnections,
  MapResources,
  type MapResourcesInput,
  type OpResult,
  type ProjectConfigOpts,
  type ProjectConfigStep,
  type ProjectVariable,
  RemoveDatabaseConnection,
  RepairDatabaseConnections,
  type RowSampleRequest,
  SampleDatabaseRows,
  SetDatabaseConnectionUrl,
} from "@antelopejs/interface-dms-builder";
import { z } from "zod";
import { DEFAULT_ROUTE_PREFIX, ROUTES } from "../constants/routes";
import { withinDmsTimeout } from "../dms-answer";
import { refusalMessage } from "../refusal";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REFUSED = 422;
const HTTP_UNAVAILABLE = 503;

const BUILDER_OFF =
  "@antelopejs/dms serves no builder operations in this process. Set builder.enabled to true on the dms entry of antelope.config.ts.";

const CORE_BUILDER_DISABLED =
  "The DMS builder is not enabled in this environment";

const CoreBuilderDisabledSchema = z
  .object({ message: z.string().startsWith(CORE_BUILDER_DISABLED) })
  .transform(({ message }) => message);

const QueueFullSchema = z.object({
  name: z.literal("ProviderQueueFullError"),
});

let builderOff: Promise<string | undefined> | undefined;

async function probeBuilder(): Promise<string | undefined> {
  const settled = GetDatabaseProject().then(
    () => undefined,
    (error: unknown) =>
      QueueFullSchema.safeParse(error).success
        ? BUILDER_OFF
        : CoreBuilderDisabledSchema.safeParse(error).data,
  );
  const off = await withinDmsTimeout(settled).catch(() => BUILDER_OFF);
  if (off !== undefined) builderOff = undefined;
  return off;
}

function unavailable(message: string): HTTPResult {
  return new HTTPResult(HTTP_UNAVAILABLE, { code: "unavailable", message });
}

async function fromDms<T>(
  operation: () => Promise<T>,
): Promise<T | HTTPResult> {
  builderOff ??= probeBuilder();
  const off = await builderOff;
  if (off !== undefined) return unavailable(off);
  try {
    return await operation();
  } catch (error) {
    const message = CoreBuilderDisabledSchema.safeParse(error).data;
    if (message === undefined) throw error;
    builderOff = undefined;
    return unavailable(message);
  }
}

interface RemoveConnectionBody {
  connection: string;
  dryRun?: boolean;
}

interface ConnectionUrlBody {
  connection: string;
  /** The new URL; with no password, the current one is kept. */
  url: string;
}

interface SampleBody extends RowSampleRequest {
  connection: string;
}

interface ProjectBody {
  steps: ProjectConfigStep[];
  opts?: ProjectConfigOpts;
  /** Variables' development values, written into `.env` before the configuration. */
  variables?: ProjectVariable[];
}

function dataOrStatus<T>(result: OpResult<T>): T | HTTPResult {
  if (result.ok) return result.data;
  if (result.error.code === "not_found") {
    return new HTTPResult(HTTP_NOT_FOUND, {
      code: "not_found",
      ref: result.error.ref,
    });
  }
  return new HTTPResult(HTTP_REFUSED, {
    code: "refused",
    message: refusalMessage(result.error),
  });
}

export class DatabaseController extends Controller(DEFAULT_ROUTE_PREFIX) {
  @Get(ROUTES.databaseConnections)
  async connections(@AuthTenantOwner() _user: User) {
    return fromDms(() => ListDatabaseConnections());
  }

  /**
   * Repairs the connections made before the connect flow registered them with dms-database: adds
   * what the configuration is missing, and answers an empty success when nothing is.
   */
  @Post(ROUTES.databaseConnectionsRepair)
  async repairConnections(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: ProjectConfigOpts | undefined,
  ) {
    return fromDms(() => RepairDatabaseConnections({ dryRun: body?.dryRun }));
  }

  @Post(ROUTES.databaseConnectionsCheck)
  async checkConnection(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: DatabaseCheckInput,
  ) {
    return fromDms(async () => {
      const result = await CheckDatabaseConnection(body);
      if (result.ok) return result.data;
      return result.error.code === "unsupported"
        ? new HTTPResult(HTTP_FORBIDDEN, {
            code: "forbidden",
            message: refusalMessage(result.error),
          })
        : new HTTPResult(HTTP_BAD_REQUEST, {
            code: "bad_request",
            message: refusalMessage(result.error),
          });
    });
  }

  @Post(ROUTES.databaseAnalyse)
  async analyse(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: AnalyseDatabaseInput,
  ) {
    return fromDms(() => AnalyseDatabase(body));
  }

  /** One analysis by `id`, or the latest of a `connection`: the running one, or else the last to finish. */
  @Get(ROUTES.databaseAnalysis)
  async analysis(
    @AuthTenantOwner() _user: User,
    @Parameter("id", "query") id: QueryValue,
    @Parameter("connection", "query") connection: QueryValue,
  ) {
    return fromDms(async () => {
      const analysisId = queryText(id);
      if (analysisId) {
        return GetAnalysis(analysisId);
      }
      const latest = await GetLatestAnalysis(queryText(connection) ?? "");
      return latest.ok ? latest : new HTTPResult(HTTP_NOT_FOUND, latest.error);
    });
  }

  @Post(ROUTES.databaseMap)
  async map(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: MapResourcesInput,
  ) {
    return fromDms(() => MapResources(body));
  }

  @Get(ROUTES.databaseMapping)
  async mapping(
    @AuthTenantOwner() _user: User,
    @Parameter("connection", "query") connection: QueryValue,
    @Parameter("module", "query") module: QueryValue,
  ) {
    return fromDms(() =>
      GetMapping(queryText(connection) ?? "", queryText(module) ?? ""),
    );
  }

  @Get(ROUTES.databaseProject)
  async projectModules(@AuthTenantOwner() _user: User) {
    return fromDms(async () => dataOrStatus(await GetDatabaseProject()));
  }

  @Post(ROUTES.databaseProject)
  async project(@AuthTenantOwner() _user: User, @JSONBody() body: ProjectBody) {
    const opts: ConfigureProjectOpts = {
      ...body.opts,
      variables: body.variables,
    };
    return fromDms(() => ConfigureProject(body.steps, opts));
  }

  @Get(ROUTES.databaseConnection)
  async connection(
    @AuthTenantOwner() _user: User,
    @Parameter("connection", "query") connection: QueryValue,
  ) {
    return fromDms(async () =>
      dataOrStatus(await GetDatabaseConnection(queryText(connection) ?? "")),
    );
  }

  @Post(ROUTES.databaseConnectionRemove)
  async removeConnection(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: RemoveConnectionBody,
  ) {
    return fromDms(() =>
      RemoveDatabaseConnection(body.connection, { dryRun: body.dryRun }),
    );
  }

  @Post(ROUTES.databaseConnectionUrl)
  async connectionUrl(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: ConnectionUrlBody,
  ) {
    return fromDms(() => SetDatabaseConnectionUrl(body.connection, body.url));
  }

  @Post(ROUTES.databaseSample)
  async sample(@AuthTenantOwner() _user: User, @JSONBody() body: SampleBody) {
    const { connection, relation, columns, limit } = body;
    return fromDms(async () =>
      dataOrStatus(
        await SampleDatabaseRows(connection, { relation, columns, limit }),
      ),
    );
  }
}
