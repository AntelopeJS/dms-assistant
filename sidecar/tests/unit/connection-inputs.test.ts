import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnyServerEvent } from "../../src/protocol/events.js";
import { type JsonValue, JsonValueSchema } from "../../src/protocol/json.js";
import { BINDINGS, listTools } from "../helpers/mcp-tools.js";

const HOST_COMMAND_PREFIX = "host_command_";

/** Words of a field name that make it a connection's address, or part of one. */
const CONNECTION_WORDS: ReadonlySet<string> = new Set([
  "address",
  "dsn",
  "endpoint",
  "host",
  "hostname",
  "href",
  "ip",
  "port",
  "socket",
  "uri",
  "url",
  "urls",
  "connection",
]);

/** JSON Schema string formats that hold an address. */
const ADDRESS_FORMATS: ReadonlySet<string> = new Set([
  "hostname",
  "idn-hostname",
  "ipv4",
  "ipv6",
  "iri",
  "iri-reference",
  "uri",
  "uri-reference",
  "uri-template",
]);

/**
 * The address-shaped inputs that name no connection, each with why, by the
 * tool and the field's path.
 */
const NOT_CONNECTIONS: ReadonlyMap<string, string> = new Map([
  [
    "preview_blocks: reference.url",
    "the same-origin path of an image the preview shows; an external URL only shows as a link",
  ],
]);

interface SchemaInput {
  path: string;
  name: string;
  format?: string;
}

function words(name: string): string[] {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
}

const JsonListSchema = z.array(JsonValueSchema);
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
const FormatSchema = z.string();

function fieldsOf(properties: JsonValue, path: string): SchemaInput[] {
  const fields = JsonObjectSchema.safeParse(properties);
  if (!fields.success) return [];
  return Object.entries(fields.data).flatMap(([name, field]) => {
    const fieldPath = path === "" ? name : `${path}.${name}`;
    return [{ path: fieldPath, name }, ...inputsOf(field, fieldPath)];
  });
}

/** Every field a JSON Schema declares at any depth, by its path, and every string format it sets. */
function inputsOf(schema: JsonValue, path: string): SchemaInput[] {
  const list = JsonListSchema.safeParse(schema);
  if (list.success) return list.data.flatMap((item) => inputsOf(item, path));
  const node = JsonObjectSchema.safeParse(schema);
  if (!node.success) return [];
  return Object.entries(node.data).flatMap(([key, value]): SchemaInput[] => {
    if (key === "properties") return fieldsOf(value, path);
    const format = FormatSchema.safeParse(value);
    if (key === "format" && format.success)
      return [{ path, name: "", format: format.data }];
    return inputsOf(value, path);
  });
}

function isAddress(input: SchemaInput): boolean {
  return input.format === undefined
    ? words(input.name).some((word) => CONNECTION_WORDS.has(word))
    : ADDRESS_FORMATS.has(input.format);
}

/** The address-shaped inputs of `schema` outside `NOT_CONNECTIONS`, as `<subject>: <path>`. */
function addressInputs(subject: string, schema: JsonValue): string[] {
  return inputsOf(schema, "")
    .filter(isAddress)
    .map((input) => `${subject}: ${input.path}`)
    .filter((input) => !NOT_CONNECTIONS.has(input));
}

/** The commands the agent sends to the owner's dashboard. */
const HOST_COMMANDS = AnyServerEvent.options.filter((event) =>
  event.shape.type.value.startsWith(HOST_COMMAND_PREFIX),
);

describe.each(BINDINGS)("tools served by %s", (_binding, build) => {
  /** Fails on a tool of the chat's MCP server that lets the model name a database URL, a host, a port or a socket. */
  it("take no connection address as input", async () => {
    const tools = await listTools(build());
    expect(tools.length).toBeGreaterThan(0);
    const offenders = tools.flatMap((tool) =>
      addressInputs(tool.name, JsonValueSchema.parse(tool.inputSchema)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the agent's commands to the dashboard", () => {
  /** Fails on a host command that carries a database URL, a host, a port or a socket to the owner's dashboard. */
  it("carry no connection address", () => {
    expect(HOST_COMMANDS.length).toBeGreaterThan(0);
    const offenders = HOST_COMMANDS.flatMap((command) =>
      addressInputs(
        command.shape.type.value,
        JsonValueSchema.parse(z.toJSONSchema(command)),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
