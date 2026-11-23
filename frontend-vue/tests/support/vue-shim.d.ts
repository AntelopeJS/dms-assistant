/** A single-file component, typed as the workspace's Volar would type any of them. */
declare module "*.vue" {
	import type { DefineComponent } from "vue";

	const component: DefineComponent;
	export default component;
}
