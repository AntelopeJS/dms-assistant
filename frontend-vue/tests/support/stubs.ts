import { UButton } from "./stand-ins/UButton";
import { UKbd } from "./stand-ins/UKbd";
import { UBadge } from "./stand-ins/UBadge";
import { UModal } from "./stand-ins/UModal";
import { UDropdownMenu } from "./stand-ins/UDropdownMenu";
import { UPopover } from "./stand-ins/UPopover";
import { UInput } from "./stand-ins/UInput";
import { UTextarea } from "./stand-ins/UTextarea";
import { DmsSegmentedControl } from "./stand-ins/DmsSegmentedControl";
import { DmsEmptyState } from "./stand-ins/DmsEmptyState";
import { DmsStatusPill } from "./stand-ins/DmsStatusPill";

/** Every Nuxt UI and DMS component the panel draws, as light stand-ins. */
export const PANEL_STUBS = {
	UIcon: true,
	UButton,
	UKbd,
	UBadge,
	UModal,
	UDropdownMenu,
	UPopover,
	UInput,
	UTextarea,
	DmsSegmentedControl,
	DmsEmptyState,
	DmsStatusPill,
	DmsIconWell: true,
};
