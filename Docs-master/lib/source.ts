import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import { type InferPageType } from 'fumadocs-core/source';

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});


export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.png'];
  return {
    segments,
    url: `https://pedropathing.com/og/docs/${segments.join('/')}`,
  };
}
