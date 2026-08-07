import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Static export → apps/web/out/robots.txt */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/docs/"],
        disallow: ["/admin/", "/projects/", "/downloads/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
