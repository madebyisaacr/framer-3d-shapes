import { Draggable, framer, useIsAllowedTo } from "framer-plugin";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminUI from "./AdminUI";
import assetsData from "./data/assets.json";
import categoriesData from "./data/categories.json";
import { SearchIcon } from "./icons";
import { normalizeFramerImageUrl } from "./utils";
import "./App.css";

const isLocalhost =
	typeof window !== "undefined" &&
	(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const PAGE_SIZE = 24;

void framer.showUI({
	position: "top right",
	width: framer.mode === "canvas" ? 260 : 600,
	minWidth: framer.mode === "canvas" ? 260 : 600,
	maxWidth: 750,
	minHeight: 400,
	resizable: framer.mode === "canvas",
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

function filterAssetsByQuery(assets: AssetImage[], query: string): AssetImage[] {
	const q = query.trim().toLowerCase();
	if (!q) return assets;
	return assets.filter((a) => a.name.toLowerCase().includes(q));
}

function filterAssetsByCategory(assets: AssetImage[], categoryId: string): AssetImage[] {
	if (!categoryId) return assets;
	return assets.filter((a) => assetGroupToCategory.get(a.assetGroupId) === categoryId);
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

	return (
		<React.StrictMode>
			{isLocalhost && showAdminUI ? <AdminUI /> : <AssetPicker />}
		</React.StrictMode>
	);
}

function AssetPicker() {
	const [query, setQuery] = useState("");
	const [categoryId, setCategoryId] = useState("");
	const debouncedQuery = useDebounce(query, 200);

	return (
		<main>
			<div className="search-header">
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
			</div>
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
			<PhotosList query={debouncedQuery} categoryId={categoryId} />
		</main>
	);
}

type AssetId = string;

const PhotosList = memo(function PhotosList({
	query,
	categoryId,
}: {
	query: string;
	categoryId: string;
}) {
	const isAllowedToUpsertImage = useIsAllowedTo("addImage", "setImage");
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
			if (mode === "canvas") {
				await framer.addImage({
					image: asset.url,
					name: asset.name,
					altText: asset.name,
				});
			} else {
				await framer.setImage({
					image: asset.url,
					name: asset.name,
					altText: asset.name,
				});
				framer.closePlugin();
			}
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
			<div className={`assets-grid ${framer.mode === "canvas" ? "canvas" : "image"}`}>
				{flatAssets.map((asset) => (
					<GridItem
						key={asset.id}
						asset={asset}
						loading={loadingId === asset.id}
						onSelect={addAsset}
						isAllowedToUpsertImage={isAllowedToUpsertImage}
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
}

const GridItem = memo(function GridItem({
	asset,
	loading,
	onSelect,
	isAllowedToUpsertImage,
}: GridItemProps) {
	const handleClick = useCallback(() => {
		onSelect(asset);
	}, [onSelect, asset]);

	return (
		<div key={asset.id} className="grid-item">
			<Draggable
				data={{
					type: "image",
					image: asset.url,
					previewImage: normalizeFramerImageUrl(asset.url),
					name: asset.name,
					altText: asset.name,
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
				</button>
			</Draggable>
			{/* <span className="grid-item-label">{asset.name}</span> */}
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
