import type { APIContext, MarkdownHeading } from 'astro';
import project from 'virtual:starlight/project-context';
import config from 'virtual:starlight/user-config';
import { generateToC, type TocItem } from './generateToC';
import { getNewestCommitDate } from 'virtual:starlight/git-info';
import { getPrevNextLinks, getSidebar, type SidebarEntry } from './navigation';
import { ensureTrailingSlash } from './path';
import {
	getRouteBySlugParam,
	normalizeCollectionEntry,
	type Route,
	type StarlightDocsCollectionEntry,
	type StarlightDocsEntry,
} from './routing';
import { formatPath } from './format-path';
import { useTranslations } from './translations';
import { BuiltInDefaultLocale, DeprecatedLabelsPropProxy } from './i18n';
import { getEntry, render, type RenderResult } from 'astro:content';
import { getCollectionPathFromRoot } from './collection';

export interface PageProps extends Route {
	headings: MarkdownHeading[];
}

export interface StarlightRouteData extends Route {
	/** Title of the site. */
	siteTitle: string;
	/** URL or path used as the link when clicking on the site title. */
	siteTitleHref: string;
	/** Array of Markdown headings extracted from the current page. */
	headings: MarkdownHeading[];
	/** Site navigation sidebar entries for this page. */
	sidebar: SidebarEntry[];
	/** Whether or not the sidebar should be displayed on this page. */
	hasSidebar: boolean;
	/** Links to the previous and next page in the sidebar if enabled. */
	pagination: ReturnType<typeof getPrevNextLinks>;
	/** Table of contents for this page if enabled. */
	toc: { minHeadingLevel: number; maxHeadingLevel: number; items: TocItem[] } | undefined;
	/** JS Date object representing when this page was last updated if enabled. */
	lastUpdated: Date | undefined;
	/** URL object for the address where this page can be edited if enabled. */
	editUrl: URL | undefined;
	/** @deprecated Use `Astro.locals.t()` instead. */
	labels: Record<string, never>;
	/** An Astro component to render the current page’s content if this route is a Markdown page. */
	Content?: RenderResult['Content'];
}

export async function useRouteData(context: APIContext): Promise<StarlightRouteData> {
	const route =
		('slug' in context.params && getRouteBySlugParam(context.params.slug)) ||
		(await get404Route(context.locals));
	const { Content, headings } = await render(route.entry);
	const routeData = generateRouteData({ props: { ...route, headings }, url: context.url });
	return { ...routeData, Content };
}

export function generateRouteData({
	props,
	url,
}: {
	props: PageProps;
	url: URL;
}): StarlightRouteData {
	const { entry, locale, lang } = props;
	const sidebar = getSidebar(url.pathname, locale);
	const siteTitle = getSiteTitle(lang);
	return {
		...props,
		siteTitle,
		siteTitleHref: getSiteTitleHref(locale),
		sidebar,
		hasSidebar: entry.data.template !== 'splash',
		pagination: getPrevNextLinks(sidebar, config.pagination, entry.data),
		toc: getToC(props),
		lastUpdated: getLastUpdated(props),
		editUrl: getEditUrl(props),
		labels: DeprecatedLabelsPropProxy,
	};
}

export function getToC({ entry, lang, headings }: PageProps) {
	const tocConfig =
		entry.data.template === 'splash'
			? false
			: entry.data.tableOfContents !== undefined
				? entry.data.tableOfContents
				: config.tableOfContents;
	if (!tocConfig) return;
	const t = useTranslations(lang);
	return {
		...tocConfig,
		items: generateToC(headings, { ...tocConfig, title: t('tableOfContents.overview') }),
	};
}

function getLastUpdated({ entry }: PageProps): Date | undefined {
	const { lastUpdated: frontmatterLastUpdated } = entry.data;
	const { lastUpdated: configLastUpdated } = config;

	if (frontmatterLastUpdated ?? configLastUpdated) {
		try {
			return frontmatterLastUpdated instanceof Date
				? frontmatterLastUpdated
				: getNewestCommitDate(entry.filePath);
		} catch {
			// If the git command fails, ignore the error.
			return undefined;
		}
	}

	return undefined;
}

function getEditUrl({ entry }: PageProps): URL | undefined {
	const { editUrl } = entry.data;
	// If frontmatter value is false, editing is disabled for this page.
	if (editUrl === false) return;

	let url: string | undefined;
	if (typeof editUrl === 'string') {
		// If a URL was provided in frontmatter, use that.
		url = editUrl;
	} else if (config.editLink.baseUrl) {
		// If a base URL was added in Starlight config, synthesize the edit URL from it.
		url = ensureTrailingSlash(config.editLink.baseUrl) + entry.filePath;
	}
	return url ? new URL(url) : undefined;
}

/** Get the site title for a given language. **/
export function getSiteTitle(lang: string): string {
	const defaultLang = config.defaultLocale.lang as string;
	if (lang && config.title[lang]) {
		return config.title[lang] as string;
	}
	return config.title[defaultLang] as string;
}

export function getSiteTitleHref(locale: string | undefined): string {
	return formatPath(locale || '/');
}

/** Generate a route object for Starlight’s 404 page. */
async function get404Route(locals: App.Locals): Promise<Route> {
	const { lang = BuiltInDefaultLocale.lang, dir = BuiltInDefaultLocale.dir } =
		config.defaultLocale || {};
	let locale = config.defaultLocale?.locale;
	if (locale === 'root') locale = undefined;

	const entryMeta = { dir, lang, locale };

	const fallbackEntry: StarlightDocsEntry = {
		slug: '404',
		id: '404',
		body: '',
		collection: 'docs',
		data: {
			title: '404',
			template: 'splash',
			editUrl: false,
			head: [],
			hero: { tagline: locals.t('404.text'), actions: [] },
			pagefind: false,
			sidebar: { hidden: false, attrs: {} },
			draft: false,
		},
		filePath: `${getCollectionPathFromRoot('docs', project)}/404.md`,
	};

	const userEntry = (await getEntry('docs', '404')) as StarlightDocsCollectionEntry;
	const entry = userEntry ? normalizeCollectionEntry(userEntry) : fallbackEntry;
	return { ...entryMeta, entryMeta, entry, id: entry.id, slug: entry.slug };
}
