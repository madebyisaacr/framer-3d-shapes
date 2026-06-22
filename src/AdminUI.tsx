import { framer, isBreakpoint, isFrameNode } from "@framer/plugin";
import { copyToClipboard } from "./utils";

export default function AdminUI() {
	const getImageData = async () => {
		const selection = await framer.getSelection();
		const frames = selection.filter(isFrameNode);
		return frames
			.map((frame) => ({
				name: frame.name,
				url: frame.backgroundImage?.url,
			}))
			.filter((item) => item.url);
	};

	const onCopySelection = async () => {
		const imageData = await getImageData();
		if (imageData.length === 0) {
			framer.notify("No images found in selection");
			return;
		}
		const success = await copyToClipboard(JSON.stringify(imageData, null, 2));
		if (success) {
			framer.notify("Selected images copied to clipboard", {
				variant: "success",
			});
		} else {
			framer.notify("Failed to copy selected images to clipboard", { variant: "error" });
		}
	};

	const onCopyAll = async () => {
		const pages = await framer.getNodesWithType("WebPageNode");

		const result = {};

		for (const page of pages) {
			if (!page.path) continue;
			const key = page.path.replace("/", "");
			if (!key) continue;

			const pageImages = [];

			const children = await page.getChildren();
			const primaryBreakpoint = children.find(
				(child) => isBreakpoint(child) && child.isPrimaryBreakpoint
			);
			if (!primaryBreakpoint) continue;

			const breakpointChildren = await primaryBreakpoint.getChildren();

			for (const sectionFrame of breakpointChildren.filter(isFrameNode)) {
				const category = sectionFrame.name;

				const sectionChildren = await sectionFrame.getChildren();
				const frames = sectionChildren.filter(isFrameNode);

				for (const frame of frames) {
					if (!frame.backgroundImage?.url) continue;
					pageImages.push({
						name: frame.name,
						url: frame.backgroundImage?.url,
						category,
					});
				}
			}

			if (pageImages.length > 0) {
				result[key] = pageImages;
			}
		}

		if (Object.keys(result).length === 0) {
			framer.notify("No images found in any pages", { variant: "error" });
			return;
		}

		const success = await copyToClipboard(JSON.stringify(result, null, 2));
		if (success) {
			framer.notify("All images copied to clipboard", { variant: "success" });
		} else {
			framer.notify("Failed to copy all images to clipboard", { variant: "error" });
		}
	};

	return (
		<main className="admin-ui">
			<button onClick={onCopySelection}>Copy Selection</button>
			<button onClick={onCopyAll}>Copy All Images</button>
		</main>
	);
}
