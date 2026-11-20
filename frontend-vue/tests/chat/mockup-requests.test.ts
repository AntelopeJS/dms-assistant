import { describe, expect, it } from "vitest";
import {
	type MockupRequest,
	mockupRequestMessage,
} from "../../app/chat/utils/mockup-requests";
import en from "../../i18n/locales/dms-assistant-panel-en-GB.json";
import fr from "../../i18n/locales/dms-assistant-panel-fr-FR.json";
import { createTestI18n } from "../support/i18n";

const LOCALES = { en, fr };

function message(locale: keyof typeof LOCALES, request: MockupRequest) {
	return mockupRequestMessage(request, createTestI18n(LOCALES[locale]).t);
}

const RESOLVE_REQUESTS: MockupRequest[] = [
	{ kind: "resolve-comments", mockup: "shop-admin" },
	{ kind: "resolve-comments", mockup: "shop-admin", page: "home" },
];

describe("how a mockup request names its mockup", () => {
	it("puts the title beside the folder name when they differ (fails when the title or the name is dropped)", () => {
		const build: MockupRequest = {
			kind: "build",
			mockup: "shop-admin",
			title: "Shop admin",
		};
		const resolve: MockupRequest = {
			kind: "resolve-comments",
			mockup: "shop-admin",
			title: "Shop admin",
			page: "home",
		};
		expect(message("en", build)).toMatch(
			/^Build the mockup “Shop admin” \(shop-admin\) into real pages/,
		);
		expect(message("en", resolve)).toMatch(
			/^Resolve the open comments of page home of the mockup “Shop admin” \(shop-admin\), and only that page\./,
		);
		expect(message("fr", build)).toMatch(
			/^Construis la maquette « Shop admin » \(shop-admin\) en vraies pages/,
		);
		expect(message("fr", resolve)).toMatch(
			/^Résous les commentaires ouverts de la page home de la maquette « Shop admin » \(shop-admin\), et de cette page seulement\./,
		);
	});

	it("names the mockup alone when it has no title of its own, as dms 0.20.x sends it (fails when an absent, blank or same title is shown)", () => {
		const titles = [undefined, "", "  ", "shop-admin"];
		for (const title of titles) {
			const request: MockupRequest = {
				kind: "build",
				mockup: "shop-admin",
				...(title === undefined ? {} : { title }),
			};
			expect(message("en", request)).toMatch(
				/^Build the mockup “shop-admin” into real pages/,
			);
			expect(message("fr", request)).toMatch(
				/^Construis la maquette « shop-admin » en vraies pages/,
			);
		}
	});
});

describe("the request that resolves a mockup's comments", () => {
	it("states the whole procedure and asks for no skill, in every locale (fails when the run needs the dms-mockup skill or loses a step)", () => {
		for (const locale of ["en", "fr"] as const) {
			for (const request of RESOLVE_REQUESTS) {
				const text = message(locale, request);
				expect(text).not.toMatch(/dms-mockup/);
				expect(text).toContain("spec.json");
				const steps = [
					"mockup_annotations",
					"mockup_patch_spec",
					"mockup_resolve_annotation",
				].map((tool) => text.indexOf(tool));
				expect(steps.every((index) => index >= 0)).toBe(true);
				expect([...steps].sort((a, b) => a - b)).toEqual(steps);
			}
		}
	});
});

describe("the request that builds a mockup", () => {
	it("asks for a link to each page built, in every locale (fails when a locale drops the links)", () => {
		const builds: MockupRequest[] = [
			{ kind: "build", mockup: "bikes" },
			{ kind: "build", mockup: "bikes", pageRef: "/shop/board" },
		];
		for (const request of builds) {
			expect(message("en", request)).toMatch(
				/Markdown link to (each|that) page/,
			);
			expect(message("fr", request)).toMatch(
				/lien Markdown vers (chaque|cette) page/,
			);
		}
	});

	it("forbids building another block in place of one it cannot build, and asks for it to be reported, in every locale (fails when a build may swap a percentage KPI for a count)", () => {
		const builds: MockupRequest[] = [
			{ kind: "build", mockup: "bikes" },
			{ kind: "build", mockup: "bikes", pageRef: "/shop/board" },
		];
		for (const request of builds) {
			expect(message("en", request)).toMatch(
				/build nothing else in its place and tell me which block and why/,
			);
			expect(message("fr", request)).toMatch(
				/ne construis rien d’autre à sa place et dis-moi lequel et pourquoi/,
			);
		}
	});
});
