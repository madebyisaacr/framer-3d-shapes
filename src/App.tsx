import { Draggable, framer, type ImageAsset, useIsAllowedTo } from "framer-plugin";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminUI from "./AdminUI";
import assetsData from "./data/assets.json";
import categoriesData from "./data/categories.json";
import groupsData from "./data/groups.json";
import sourcesData from "./data/sources.json";
// import { SearchIcon } from "./icons";
import { normalizeFramerImageUrl } from "./utils";
import "./App.css";

const isLocalhost =
	typeof window !== "undefined" &&
	(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const PAGE_SIZE = 24;
const IS_CANVAS = framer.mode === "canvas";

const LICENSE_URLS = {
	"CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
};

void framer.showUI({
	position: "top right",
	width: IS_CANVAS ? 260 : 600,
	minWidth: IS_CANVAS ? 260 : 600,
	maxWidth: 750,
	height: IS_CANVAS ? 450 : 600,
	minHeight: 400,
	resizable: IS_CANVAS,
});

type AssetImage = { id: string; name: string; url: string; assetGroupId: string };

const dataByCategory = assetsData as Record<string, Array<{ name: string; url: string }>>;
const allAssets: AssetImage[] = [];
for (const [assetGroupId, items] of Object.entries(dataByCategory)) {
	if (!Array.isArray(items)) continue;
	items.forEach((item, index) => {
		allAssets.push({
			id: `${assetGroupId}-${index}-${item.url}`,
			name: item.name,
			url: item.url,
			assetGroupId,
		});
	});
}

type CategoryEntry = { name: string; assetGroups: string[] };
const categoriesDataTyped = categoriesData as Record<string, CategoryEntry>;
type GroupEntry = { colorizable: boolean; source: string };
type SourceEntry = {
	source: string;
	sourceTitle: string;
	authorName: string;
	license?: string | null;
};
const groupsDataTyped = groupsData as Record<string, GroupEntry>;
const sourcesDataTyped = sourcesData as Record<string, SourceEntry>;
const categoriesList = Object.entries(categoriesDataTyped).map(([id, entry]) => ({
	value: id,
	label: entry.name,
}));
const assetGroupToCategory = new Map<string, string>();
for (const [catId, entry] of Object.entries(categoriesDataTyped)) {
	for (const groupId of entry.assetGroups) {
		assetGroupToCategory.set(groupId, catId);
	}
}

const CATEGORY_STORAGE_KEY = "framer-3d-shapes-category";
const validCategoryIds = new Set(["", ...Object.keys(categoriesDataTyped)]);

const allGroupIds = Object.keys(groupsDataTyped);

function shuffleInPlace<T>(array: T[]): void {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}

shuffleInPlace(allGroupIds);

const randomizedGroupOrder = new Map<string, number>(
	allGroupIds.map((groupId, index) => [groupId, index])
);

function inferFilenameFromUrl(url: string, fallbackBaseName: string) {
	try {
		const { pathname } = new URL(url);
		const lastSegment = pathname.split("/").filter(Boolean).pop();
		if (lastSegment && lastSegment.includes(".")) return lastSegment;
	} catch {
		// ignore
	}
	const safeBase = fallbackBaseName.trim().replace(/[^\w-]+/g, "_") || "asset";
	return `${safeBase}.png`;
}

async function downloadAssetUrl(url: string, name: string) {
	const filename = inferFilenameFromUrl(url, name);
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Download failed: ${res.status}`);
		const blob = await res.blob();
		const objectUrl = URL.createObjectURL(blob);
		try {
			const a = document.createElement("a");
			a.href = objectUrl;
			a.download = filename;
			a.rel = "noopener noreferrer";
			document.body.appendChild(a);
			a.click();
			a.remove();
			framer.notify(`Downloaded asset`, { variant: "success" });
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	} catch {
		// Fallback: let the browser handle it (may open in a new tab depending on headers)
		const a = document.createElement("a");
		a.href = url;
		a.target = "_blank";
		a.rel = "noopener noreferrer";
		a.click();
		framer.notify(`Downloaded asset`, { variant: "success" });
	}
}

function showAssetContextMenu(opts: {
	asset: AssetImage;
	location: { x: number; y: number };
	isInsertEnabled: boolean;
	onInsert: () => void;
	onInfo: () => void;
	showInfo?: boolean;
}) {
	const { asset, location, isInsertEnabled, onInsert, onInfo, showInfo = true } = opts;
	void framer.showContextMenu(
		[
			{
				label: "Insert",
				enabled: isInsertEnabled,
				onAction: () => {
					if (!isInsertEnabled) return;
					onInsert();
				},
			},
			{
				label: "Download",
				onAction: () => {
					void downloadAssetUrl(asset.url, asset.name);
				},
			},
			...(showInfo
				? ([
						{
							label: "Info",
							onAction: () => {
								onInfo();
							},
						},
					] as const)
				: []),
		],
		{ location }
	);
}

function getStoredCategoryId(): string {
	try {
		const stored = localStorage.getItem(CATEGORY_STORAGE_KEY);
		if (stored !== null && validCategoryIds.has(stored)) return stored;
	} catch {
		// ignore
	}
	return "";
}

function filterAssetsByQuery(assets: AssetImage[], query: string): AssetImage[] {
	const q = query.trim().toLowerCase();
	if (!q) return assets;
	return assets.filter((a) => a.name.toLowerCase().includes(q));
}

function filterAssetsByCategory(assets: AssetImage[], categoryId: string): AssetImage[] {
	if (!categoryId) {
		return assets
			.slice()
			.sort(
				(a, b) =>
					(randomizedGroupOrder.get(a.assetGroupId) ?? Number.MAX_SAFE_INTEGER) -
					(randomizedGroupOrder.get(b.assetGroupId) ?? Number.MAX_SAFE_INTEGER)
			);
	}
	const category = categoriesDataTyped[categoryId];
	if (!category) return assets;

	const groupOrder = new Map<string, number>();
	category.assetGroups.forEach((groupId, index) => {
		groupOrder.set(groupId, index);
	});

	return assets
		.filter((a) => groupOrder.has(a.assetGroupId))
		.sort((a, b) => (groupOrder.get(a.assetGroupId) ?? 0) - (groupOrder.get(b.assetGroupId) ?? 0));
}

function useAssetsInfinite(query: string, categoryId: string) {
	const filtered = useMemo(() => {
		const byCategory = filterAssetsByCategory(allAssets, categoryId);
		return filterAssetsByQuery(byCategory, query);
	}, [query, categoryId]);
	const [pageIndex, setPageIndex] = useState(0);

	const pages = useMemo(() => {
		const result: { results: AssetImage[] }[] = [];
		for (let i = 0; i < filtered.length; i += PAGE_SIZE) {
			result.push({ results: filtered.slice(i, i + PAGE_SIZE) });
		}
		return result;
	}, [filtered]);

	const visiblePages = useMemo(() => pages.slice(0, pageIndex + 1), [pages, pageIndex]);

	const data = useMemo(
		() => (visiblePages.length > 0 ? { pages: visiblePages } : null),
		[visiblePages]
	);

	const hasNextPage = pageIndex + 1 < pages.length;
	const fetchNextPage = useCallback(() => {
		if (hasNextPage) setPageIndex((p) => p + 1);
	}, [hasNextPage]);

	useEffect(() => {
		setPageIndex(0);
	}, [query, categoryId]);

	return {
		data,
		fetchNextPage,
		isFetchingNextPage: false,
		isLoading: false,
		hasNextPage,
	};
}

export function App() {
	const [showAdminUI, setShowAdminUI] = useState(false);

	useEffect(() => {
		if (!isLocalhost) {
			void framer.setMenu([]);
			return;
		}
		void framer.setMenu([
			{
				label: showAdminUI ? "Back" : "Admin Menu",
				onAction: () => setShowAdminUI((prev) => !prev),
			},
		]);
	}, [showAdminUI]);

	return isLocalhost && showAdminUI ? <AdminUI /> : <AssetPicker />;
}

function AssetPicker() {
	const [query] = useState("");
	const [categoryId, setCategoryId] = useState(getStoredCategoryId);
	const [showModal, setShowModal] = useState(false);
	const [modalContent, setModalContent] = useState<SourceEntry | null>(null);
	const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
	const [modalAsset, setModalAsset] = useState<AssetImage | null>(null);
	const isAllowedToUpsertImage = useIsAllowedTo("addImage", "setImage", "Node.setAttributes");

	useEffect(() => {
		try {
			localStorage.setItem(CATEGORY_STORAGE_KEY, categoryId);
		} catch {
			// ignore
		}
	}, [categoryId]);

	const debouncedQuery = useDebounce(query, 200);

	const handleShowSource = useCallback((asset: AssetImage) => {
		const group = groupsDataTyped[asset.assetGroupId];
		if (!group) return;
		const source = sourcesDataTyped[group.source];
		if (!source) return;
		setModalContent(source);
		setModalImageUrl(asset.url);
		setModalAsset(asset);
		setShowModal(true);
	}, []);

	const handleInsertFromModal = useCallback(async () => {
		if (!modalAsset) return;
		if (!isAllowedToUpsertImage) return;
		try {
			if (IS_CANVAS) {
				let currentImage: ImageAsset | null = null;
				try {
					currentImage = await framer.getImage();
				} catch {
					console.error("Failed to get current image");
				}

				const imageData = {
					image: modalAsset.url,
					name: modalAsset.name,
				};

				if (currentImage) {
					await framer.setImage(imageData);
				} else {
					await framer.addImage(imageData);
				}
			} else {
				await framer.setImage({
					image: modalAsset.url,
					name: modalAsset.name,
				});
				framer.closePlugin();
			}
			framer.notify(`Inserted asset`, { variant: "success" });
		} catch {
			// ignore (same behavior as grid insert: don't block UI)
		}
	}, [isAllowedToUpsertImage, modalAsset]);

	const handleModalContextMenu = useCallback(
		(event: React.MouseEvent) => {
			if (!modalAsset) return;
			event.preventDefault();
			event.stopPropagation();
			showAssetContextMenu({
				asset: modalAsset,
				location: { x: event.clientX, y: event.clientY },
				isInsertEnabled: isAllowedToUpsertImage,
				onInsert: () => void handleInsertFromModal(),
				onInfo: () => handleShowSource(modalAsset),
				showInfo: false,
			});
		},
		[handleInsertFromModal, handleShowSource, isAllowedToUpsertImage, modalAsset]
	);

	return (
		<main>
			{/* <div className="search-header">
				<input
					type="text"
					placeholder="Search…"
					value={query}
					className="search-input"
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="search-icon-wrap">
					<SearchIcon />
				</div>
			</div> */}
			<select
				className="category-dropdown"
				value={categoryId}
				onChange={(e) => setCategoryId(e.target.value)}
				aria-label="Category"
			>
				<option value="">All</option>
				{categoriesList.map((cat) => (
					<option key={cat.value} value={cat.value}>
						{cat.label}
					</option>
				))}
			</select>
			<PhotosList query={debouncedQuery} categoryId={categoryId} onShowSource={handleShowSource} />
			{showModal && modalContent && (
				<div className="modal-container">
					<div className="modal-backdrop" onClick={() => setShowModal(false)} />
					<div className="modal">
						<div className="modal-content">
							{modalImageUrl && (
								<Draggable
									data={{
										type: "image",
										image: modalImageUrl,
										previewImage: normalizeFramerImageUrl(modalImageUrl),
										name: modalAsset?.name ?? modalContent.sourceTitle,
									}}
								>
									<img
										className="modal-image"
										src={normalizeFramerImageUrl(modalImageUrl)}
										alt={modalAsset?.name ?? modalContent.sourceTitle}
										draggable={false}
										onContextMenu={handleModalContextMenu}
									/>
								</Draggable>
							)}
							<p className="modal-title">Source</p>
							<p>
								<a href={modalContent.source} target="_blank" rel="noopener noreferrer">
									{modalContent.sourceTitle}
								</a>{" "}
								by {modalContent.authorName}
							</p>
							{modalContent.license && (
								<p>
									License:{" "}
									{LICENSE_URLS[modalContent.license] ? (
										<a
											href={LICENSE_URLS[modalContent.license]}
											target="_blank"
											rel="noopener noreferrer"
										>
											{modalContent.license}
										</a>
									) : (
										modalContent.license
									)}
								</p>
							)}
						</div>
						<button onClick={() => setShowModal(false)}>OK</button>
					</div>
				</div>
			)}
		</main>
	);
}

type AssetId = string;

const PhotosList = memo(function PhotosList({
	query,
	categoryId,
	onShowSource,
}: {
	query: string;
	categoryId: string;
	onShowSource: (asset: AssetImage) => void;
}) {
	const isAllowedToUpsertImage = useIsAllowedTo("addImage", "setImage", "Node.setAttributes");
	const { data, fetchNextPage, hasNextPage } = useAssetsInfinite(query, categoryId);
	const scrollRef = useRef<HTMLDivElement>(null);
	const previousWindowHeightRef = useRef(window.innerHeight);
	const [loadingId, setLoadingId] = useState<AssetId | null>(null);

	const handleScroll = useCallback(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) return;
		const distanceToEnd =
			scrollElement.scrollHeight - (scrollElement.clientHeight + scrollElement.scrollTop);
		if (distanceToEnd > 150) return;
		void fetchNextPage();
	}, [fetchNextPage]);

	useEffect(() => {
		const handleResize = () => {
			if (window.innerHeight > previousWindowHeightRef.current) {
				handleScroll();
			}
			previousWindowHeightRef.current = window.innerHeight;
		};
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [handleScroll]);

	const addAsset = useCallback(async (asset: AssetImage) => {
		setLoadingId(asset.id);
		try {
			if (IS_CANVAS) {
				// In canvas mode, update the existing image if there is one, otherwise add a new image
				let currentImage: ImageAsset | null = null;
				try {
					// This is only available in canvas mode
					currentImage = await framer.getImage();
				} catch {
					console.error("Failed to get current image");
				}

				const imageData = {
					image: asset.url,
					name: asset.name,
				};

				if (currentImage) {
					await framer.setImage(imageData);
				} else {
					await framer.addImage(imageData);
				}
			} else {
				await framer.setImage({
					image: asset.url,
					name: asset.name,
				});
				framer.closePlugin();
			}
			framer.notify(`Inserted asset`, { variant: "success" });
		} finally {
			setLoadingId(null);
		}
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = 0;
	}, [query, categoryId]);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement || !data) return;
		const isScrollable = scrollElement.scrollHeight > scrollElement.clientHeight;
		if (isScrollable || !hasNextPage) return;
		void fetchNextPage();
	}, [data, hasNextPage, fetchNextPage]);

	const flatAssets = useMemo(() => {
		if (!data) return [];
		const seen = new Set<AssetId>();
		const list: AssetImage[] = [];
		for (const page of data.pages) {
			for (const asset of page.results) {
				if (seen.has(asset.id)) continue;
				seen.add(asset.id);
				list.push(asset);
			}
		}
		return list;
	}, [data]);

	if (flatAssets.length === 0) {
		return <div className="empty-state">No images found</div>;
	}

	return (
		<div className="scroll-container no-scrollbar" ref={scrollRef} onScroll={handleScroll}>
			<div className={`assets-grid ${IS_CANVAS ? "canvas" : "image"}`}>
				{flatAssets.map((asset) => (
					<GridItem
						key={asset.id}
						asset={asset}
						loading={loadingId === asset.id}
						onSelect={addAsset}
						isAllowedToUpsertImage={isAllowedToUpsertImage}
						onShowSource={onShowSource}
					/>
				))}
			</div>
		</div>
	);
});

interface GridItemProps {
	asset: AssetImage;
	loading: boolean;
	onSelect: (asset: AssetImage) => void;
	isAllowedToUpsertImage: boolean;
	onShowSource: (asset: AssetImage) => void;
}

const GridItem = memo(function GridItem({
	asset,
	loading,
	onSelect,
	isAllowedToUpsertImage,
	onShowSource,
}: GridItemProps) {
	const handleClick = useCallback(() => {
		onSelect(asset);
	}, [onSelect, asset]);

	const handleContextMenu = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			showAssetContextMenu({
				asset,
				location: { x: event.clientX, y: event.clientY },
				isInsertEnabled: isAllowedToUpsertImage && !loading,
				onInsert: handleClick,
				onInfo: () => onShowSource(asset),
			});
		},
		[asset, handleClick, isAllowedToUpsertImage, loading, onShowSource]
	);

	return (
		<div key={asset.id} className="grid-item" onContextMenu={handleContextMenu}>
			<Draggable
				data={{
					type: "image",
					image: asset.url,
					previewImage: normalizeFramerImageUrl(asset.url),
					name: asset.name,
				}}
			>
				<button
					onClick={() => {
						if (!isAllowedToUpsertImage) return;
						handleClick();
					}}
					className="grid-item-btn"
					style={{
						backgroundImage: `url(${normalizeFramerImageUrl(asset.url)})`,
					}}
					disabled={!isAllowedToUpsertImage}
					title={isAllowedToUpsertImage ? undefined : "Insufficient permissions"}
				>
					<div className={`grid-item-overlay ${loading ? "loading" : ""}`}>
						{loading && <div className="spinner" />}
					</div>
					<div
						className="grid-item-info-btn"
						onClick={(event) => {
							event.stopPropagation();
							onShowSource(asset);
						}}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 20 20"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M10 9V14"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<circle cx="10" cy="5.5" r="1.25" fill="currentColor" />
						</svg>
					</div>
				</button>
			</Draggable>
		</div>
	);
});

function useDebounce<T>(value: T, delay: number) {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);
	useEffect(() => {
		const t = setTimeout(() => setDebouncedValue(value), delay);
		return () => clearTimeout(t);
	}, [value, delay]);
	return debouncedValue;
}
