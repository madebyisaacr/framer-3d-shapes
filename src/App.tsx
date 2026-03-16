import { Draggable, framer, useIsAllowedTo } from "framer-plugin";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import assetsData from "./assets.json";
import { SearchIcon } from "./icons";
import { normalizeFramerImageUrl } from "./utils";
import "./globals.css";

const mode = framer.mode;

const minWindowWidth = mode === "canvas" ? 260 : 600;
const resizable = framer.mode === "canvas";
const PAGE_SIZE = 24;

void framer.showUI({
	position: "top right",
	width: minWindowWidth,
	minWidth: minWindowWidth,
	maxWidth: 750,
	minHeight: 400,
	resizable,
});

type AssetImage = { id: string; name: string; url: string };

const dataByCategory = assetsData as Record<string, Array<{ name: string; url: string }>>;
const allAssets: AssetImage[] = [];
for (const [category, items] of Object.entries(dataByCategory)) {
	if (!Array.isArray(items)) continue;
	items.forEach((item, index) => {
		allAssets.push({
			id: `${category}-${index}-${item.url}`,
			name: item.name,
			url: item.url,
		});
	});
}

function filterAssetsByQuery(assets: AssetImage[], query: string): AssetImage[] {
	const q = query.trim().toLowerCase();
	if (!q) return assets;
	return assets.filter((a) => a.name.toLowerCase().includes(q));
}

function useAssetsInfinite(query: string) {
	const filtered = useMemo(() => filterAssetsByQuery(allAssets, query), [query]);
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
	}, [query]);

	return {
		data,
		fetchNextPage,
		isFetchingNextPage: false,
		isLoading: false,
		hasNextPage,
	};
}

export function App() {
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebounce(query, 200);

	return (
		<main>
			<div className="search-header">
				<input
					type="text"
					placeholder="Search assets…"
					value={query}
					className="search-input"
					autoFocus
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="search-icon-wrap">
					<SearchIcon />
				</div>
			</div>
			<PhotosList query={debouncedQuery} />
		</main>
	);
}

type AssetId = string;

const PhotosList = memo(function PhotosList({ query }: { query: string }) {
	const isAllowedToUpsertImage = useIsAllowedTo("addImage", "setImage");
	const { data, fetchNextPage, hasNextPage } = useAssetsInfinite(query);
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
	}, [query]);

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
			<div className="assets-grid">
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
