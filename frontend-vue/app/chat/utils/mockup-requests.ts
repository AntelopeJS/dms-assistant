import type {
	BuildMockupIntent,
	ResolveCommentsIntent,
} from "../../runtime/panel-intents";
import type { Translate } from "../composables/useChatI18n";

/** A request about one mockup that the panel sends at once, for the user. */
export type MockupRequest = BuildMockupIntent | ResolveCommentsIntent;

/**
 * How a request names its mockup: its title beside its folder name when the
 * title differs from the name, the name alone otherwise.
 */
function mockupLabel(request: MockupRequest, t: Translate): string {
	const name = request.mockup;
	const title = request.title?.trim() ?? "";
	return title === "" || title === name
		? t("dms_assistant.panel.mockup_label.name", { name })
		: t("dms_assistant.panel.mockup_label.titled", { name, title });
}

/** The message that asks the agent to carry out `request`. */
export function mockupRequestMessage(
	request: MockupRequest,
	t: Translate,
): string {
	const mockup = mockupLabel(request, t);
	if (request.kind === "build")
		return request.pageRef === undefined
			? t("dms_assistant.panel.build.message", { mockup })
			: t("dms_assistant.panel.build.message_into", {
					mockup,
					page: request.pageRef,
				});
	return request.page === undefined
		? t("dms_assistant.panel.resolve_comments.message", { mockup })
		: t("dms_assistant.panel.resolve_comments.message_page", {
				mockup,
				page: request.page,
			});
}
