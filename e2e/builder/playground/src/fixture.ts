import { randomUUID } from "node:crypto";
import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { RoleModel } from "@antelopejs/interface-dms/db";
import { createUserInviteToken } from "@antelopejs/interface-dms/invites";
import { z } from "zod";

const memberSchema = z.object({
  name: z.string().default("Member"),
  permissions: z.array(z.string()).default([]),
});

/** The ids of the permissions a role holds, with every id its grants sit under, as the DMS roles editor stores them. */
function withAncestors(permissions: string[]): string[] {
  return [
    ...new Set(
      permissions.flatMap((id) => {
        const segments = id.split(".");
        return segments.map((_, index) =>
          segments.slice(0, index + 1).join("."),
        );
      }),
    ),
  ];
}

/**
 * Trusted backend calls a journey cannot make over HTTP: members with a
 * role. Only the verification playground serves them.
 */
export class VerifyFixtureController extends Controller("/verify-builder") {
  /** `{ name, permissions }`: a role holding the permissions, and an invitation to join with it. */
  @Post("/member")
  async member(@JSONBody() body: unknown) {
    const { name, permissions } = memberSchema.parse(body);
    const [roleId] = await GetModel(RoleModel, DEFAULT_TENANT_ID).insert({
      name: `${name} ${randomUUID()}`,
      permissions: withAncestors(permissions),
    });
    const email = `${name.toLowerCase()}-${randomUUID()}@verify.local`;
    const { token } = await createUserInviteToken({
      tenantId: DEFAULT_TENANT_ID,
      email,
      language: "en",
      roleIds: roleId === undefined ? [] : [roleId],
      asTenantOwner: false,
    });
    if (token === undefined)
      throw new Error(`the invitation of ${email} was minted by another call`);
    return { email, token, roleId };
  }
}
