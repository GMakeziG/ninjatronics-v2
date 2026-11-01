// Read model for blog articles. Every page that lists or links articles goes
// through these helpers, so the draft rule lives in exactly one place.
import { getCollection, type CollectionEntry } from "astro:content";
import type { CategorySlug } from "../config/categories";

export type Post = CollectionEntry<"blog">;

/**
 * Drafts are visible in `astro dev` (with a DRAFT label) so they can be
 * previewed, and excluded from every production build: no page, listing,
 * tag, category, RSS item, sitemap entry, or redirect.
 */
const includeDrafts = import.meta.env.DEV;

function byNewest(a: Post, b: Post): number {
  return b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || a.id.localeCompare(b.id);
}

/** Posts that should render in this build (published, plus drafts in dev). */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", (post) => includeDrafts || !post.data.draft);
  return posts.sort(byNewest);
}

/** Published posts only, in every environment. For RSS, sitemap, redirects. */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", (post) => !post.data.draft);
  return posts.sort(byNewest);
}

/** Canonical article URL. No trailing slash: the build emits `blog/<slug>.html`. */
export const postPath = (post: Post): string => `/blog/${post.id}`;
export const categoryPath = (category: CategorySlug): string => `/blog/category/${category}`;
export const tagPath = (tag: string): string => `/blog/tags/${tag}`;

export function postsInCategory(posts: Post[], category: CategorySlug): Post[] {
  return posts.filter((post) => post.data.category === category);
}

export function postsWithTag(posts: Post[], tag: string): Post[] {
  return posts.filter((post) => post.data.tags.includes(tag));
}

/** Categories that have at least one post, in the configured order. */
export function usedCategories(posts: Post[]): Set<CategorySlug> {
  return new Set(posts.map((post) => post.data.category));
}

/** Every tag with its post count, alphabetically. */
export function tagCounts(posts: Post[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of posts) for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Previous (older) and next (newer) neighbours of a post. */
export function adjacentPosts(posts: Post[], current: Post): { older?: Post; newer?: Post } {
  const index = posts.findIndex((post) => post.id === current.id);
  return { newer: index > 0 ? posts[index - 1] : undefined, older: posts[index + 1] };
}

/** Up to `limit` related posts: same category first, then by shared tags. */
export function relatedPosts(posts: Post[], current: Post, limit = 3): Post[] {
  const score = (post: Post) =>
    (post.data.category === current.data.category ? 10 : 0) +
    post.data.tags.filter((tag) => current.data.tags.includes(tag)).length;
  return posts
    .filter((post) => post.id !== current.id)
    .map((post) => ({ post, score: score(post) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || byNewest(a.post, b.post))
    .slice(0, limit)
    .map(({ post }) => post);
}
