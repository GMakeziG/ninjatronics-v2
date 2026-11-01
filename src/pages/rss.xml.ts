import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { SITE, AUTHOR } from "../config/site";
import { getCategory } from "../config/categories";
import { getPublishedPosts, postPath } from "../lib/posts";

// Published articles only, in every environment (drafts never enter the feed).
export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();
  return rss({
    title: `${SITE.name}`,
    description: SITE.description,
    site: context.site ?? SITE.url,
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postPath(post),
      categories: [getCategory(post.data.category).label, ...post.data.tags],
      author: AUTHOR.name,
    })),
    customData: `<language>${SITE.language.toLowerCase()}</language>`,
  });
}
