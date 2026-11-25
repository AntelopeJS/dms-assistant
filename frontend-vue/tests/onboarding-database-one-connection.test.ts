/**
 * @vitest-environment jsdom
 * @packageDocumentation
 */
import { afterEach, describe, expect, it } from "vitest";
import {
	fakeBuilder,
	mountConnect,
	unmountConnect,
} from "./support/database-connect";

afterEach(() => {
	unmountConnect();
});

describe("a project with a connection of another engine", () => {
	it("refuses a MongoDB sample before it checks or writes anything (fails on a connect that rewrites the PostgreSQL connection)", async () => {
		const fake = fakeBuilder();
		const connect = mountConnect(fake.api);
		const problem = await connect.connect(
			"mongodb",
			"mongodb://app:secret@db.example.com/sample",
		);
		expect(problem).toBeNull();
		expect(connect.refusal.value).toBe(
			'database.engines.one_connection {"engine":"PostgreSQL","requested":"MongoDB"}',
		);
		expect(connect.phase.value).toEqual({ kind: "form" });
		expect(fake.checkConnection).not.toHaveBeenCalled();
		expect(fake.configureProject).not.toHaveBeenCalled();
	});
});
